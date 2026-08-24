use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

const APP_DIR: &str = "top.nexmusic.app";
const CACHE_SUBDIR: &str = "audio-cache";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

static DOWNLOADING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn downloading_set() -> &'static Mutex<HashSet<String>> {
    DOWNLOADING.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheLookup {
    pub hit: bool,
    pub url: String,
}

pub fn cache_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "无法定位本机数据目录".to_string())?;
    let dir = base.join(APP_DIR).join(CACHE_SUBDIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    Ok(dir)
}

fn sanitize_key(part: &str) -> String {
    part.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn cache_key(provider: &str, song_id: &str, quality: &str) -> String {
    format!(
        "{}_{}_{}",
        sanitize_key(provider),
        sanitize_key(song_id),
        sanitize_key(quality)
    )
}

fn ext_from_url(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains(".flac") {
        ".flac"
    } else if lower.contains(".m4a") {
        ".m4a"
    } else if lower.contains(".ogg") {
        ".ogg"
    } else if lower.contains(".wav") {
        ".wav"
    } else if lower.contains(".mp4") {
        ".mp4"
    } else {
        ".mp3"
    }
}

fn ext_from_content_type(ct: &str) -> &'static str {
    let lower = ct.to_lowercase();
    if lower.contains("flac") {
        ".flac"
    } else if lower.contains("mpeg") || lower.contains("mp3") {
        ".mp3"
    } else if lower.contains("mp4") || lower.contains("m4a") {
        ".m4a"
    } else if lower.contains("ogg") {
        ".ogg"
    } else if lower.contains("wav") {
        ".wav"
    } else {
        ".mp3"
    }
}

fn referer_for(url: &str) -> &'static str {
    if url.contains("qq.com") || url.contains("qpic.cn") {
        "https://y.qq.com/"
    } else if url.contains("kugou.com") {
        "https://www.kugou.com/"
    } else {
        "https://music.163.com/"
    }
}

fn find_cached_file(dir: &Path, key: &str) -> Option<PathBuf> {
    for ext in [".flac", ".mp3", ".m4a", ".ogg", ".wav", ".mp4"] {
        let path = dir.join(format!("{key}{ext}"));
        if path.is_file() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 0 {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn cache_playback_url(key: &str, proxy_port: u16) -> String {
    format!("http://127.0.0.1:{proxy_port}/cache?key={key}")
}

async fn download_to_cache(remote_url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(remote_url)
        .header("User-Agent", UA)
        .header("Referer", referer_for(remote_url))
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ext = ext_from_content_type(ct);
    let final_path = if dest.extension().is_none() {
        dest.with_extension(ext.trim_start_matches('.'))
    } else {
        dest.to_path_buf()
    };

    let tmp = final_path.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("写入缓存失败: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut total: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取音频失败: {e}"))?;
        if chunk.is_empty() {
            continue;
        }
        total += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入缓存失败: {e}"))?;
    }
    file.flush()
        .await
        .map_err(|e| format!("写入缓存失败: {e}"))?;

    if total == 0 {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err("下载为空".into());
    }

    if final_path.exists() {
        let _ = tokio::fs::remove_file(&final_path).await;
    }
    tokio::fs::rename(&tmp, &final_path)
        .await
        .map_err(|e| format!("保存缓存失败: {e}"))?;
    Ok(())
}

fn try_start_background_download(key: String, remote_url: String, dest: PathBuf) {
    {
        let mut set = downloading_set().lock().unwrap();
        if set.contains(&key) {
            return;
        }
        set.insert(key.clone());
    }

    tokio::spawn(async move {
        let result = download_to_cache(&remote_url, &dest).await;
        if let Err(e) = result {
            log::warn!("[AudioCache] background download failed for {key}: {e}");
        } else {
            log::info!("[AudioCache] cached {key}");
        }
        downloading_set().lock().unwrap().remove(&key);
    });
}

pub fn cache_file_path(key: &str) -> Result<Option<PathBuf>, String> {
    let dir = cache_dir()?;
    Ok(find_cached_file(&dir, key))
}

pub fn content_type_for_path(path: &Path) -> &'static str {
    let name = path.to_string_lossy().to_lowercase();
    if name.ends_with(".flac") {
        "audio/flac"
    } else if name.ends_with(".mp3") {
        "audio/mpeg"
    } else if name.ends_with(".m4a") {
        "audio/mp4"
    } else if name.ends_with(".ogg") {
        "audio/ogg"
    } else if name.ends_with(".wav") {
        "audio/wav"
    } else {
        "audio/mpeg"
    }
}

/// 仅查本地缓存，不触发下载
pub fn lookup_cache(provider: &str, song_id: &str, quality: &str, proxy_port: u16) -> Result<CacheLookup, String> {
    let dir = cache_dir()?;
    let key = cache_key(provider, song_id, quality);
    let hit = find_cached_file(&dir, &key).is_some();
    let url = if hit {
        cache_playback_url(&key, proxy_port)
    } else {
        String::new()
    };
    Ok(CacheLookup { hit, url })
}

/// 后台下载到缓存（播完后调用）
pub fn start_cache_download(provider: &str, song_id: &str, quality: &str, remote_url: &str) -> Result<(), String> {
    if remote_url.is_empty() || !remote_url.starts_with("http") {
        return Err("无效播放地址".into());
    }

    let dir = cache_dir()?;
    let key = cache_key(provider, song_id, quality);

    if find_cached_file(&dir, &key).is_some() {
        return Ok(());
    }

    let ext = ext_from_url(remote_url);
    let dest = dir.join(format!("{key}{ext}"));
    try_start_background_download(key, remote_url.to_string(), dest);
    Ok(())
}

#[tauri::command]
pub async fn audio_cache_lookup(
    provider: String,
    song_id: String,
    quality: String,
) -> Result<CacheLookup, String> {
    let port = super::audio_proxy::get_proxy_port();
    if port == 0 {
        return Err("音频代理未启动".into());
    }
    lookup_cache(&provider, &song_id, &quality, port)
}

#[tauri::command]
pub async fn audio_cache_download(
    provider: String,
    song_id: String,
    quality: String,
    remote_url: String,
) -> Result<(), String> {
    start_cache_download(&provider, &song_id, &quality, &remote_url)
}
