use std::path::{Path, PathBuf};

use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri::Manager;

fn is_audio_ext(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("mp3" | "flac" | "wav" | "m4a" | "ogg" | "aac" | "opus")
    )
}

#[cfg(target_os = "android")]
fn copy_into_app(app: &AppHandle, source: &Path) -> Result<String, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法打开应用目录: {e}"))?;
    dir.push("local-music");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建本地音乐目录失败: {e}"))?;
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("track");
    let mut dest = dir.join(name);
    if dest.exists() {
        let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("track");
        let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("audio");
        dest = dir.join(format!("{stem}-{}", std::process::id()));
        dest.set_extension(ext);
    }
    std::fs::copy(source, &dest).map_err(|e| format!("复制本地歌曲失败: {e}"))?;
    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "路径无法保存".into())
}

/// 桌面直接使用原路径。安卓选择器给出的缓存文件复制到应用目录，避免临时文件被清掉。
#[tauri::command]
pub fn prepare_local_audio(app: AppHandle, source: String) -> Result<String, String> {
    let source = source.trim().to_string();
    if source.is_empty() {
        return Err("路径为空".into());
    }
    if source.starts_with("content:") {
        return Err("系统只给了临时地址，无法导入".into());
    }
    let path = PathBuf::from(&source);
    if !path.is_file() {
        return Err("找不到这个文件".into());
    }
    if !is_audio_ext(&path) {
        return Err("不支持的音频格式".into());
    }
    #[cfg(target_os = "android")]
    {
        return copy_into_app(&app, &path);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(source)
    }
}
