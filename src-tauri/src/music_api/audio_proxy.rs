use std::sync::atomic::{AtomicU16, Ordering};
use std::path::PathBuf;
use std::sync::OnceLock;

use axum::{
    body::Body,
    extract::Query,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::StreamExt;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use tauri::AppHandle;

static PROXY_PORT: AtomicU16 = AtomicU16::new(0);
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static STREAM_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Deserialize)]
struct ProxyQuery {
    url: String,
}

#[derive(Deserialize)]
struct CoverQuery {
    url: String,
}

fn get_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to build proxy client")
    })
}

/// 流式传输专用 client —— 无整体超时，仅设连接超时
/// 避免长曲目中途被 timeout 掐断
fn get_stream_client() -> &'static reqwest::Client {
    STREAM_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("Failed to build stream proxy client")
    })
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

fn content_type_for(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains(".flac") {
        "audio/flac"
    } else if lower.contains(".mp3") {
        "audio/mpeg"
    } else if lower.contains(".mp4") {
        "video/mp4"
    } else if lower.contains(".m4a") {
        "audio/mp4"
    } else if lower.contains(".ogg") {
        "audio/ogg"
    } else if lower.contains(".wav") {
        "audio/wav"
    } else {
        "audio/mpeg"
    }
}

fn resolve_stream_content_type(upstream: Option<&str>, audio_url: &str) -> String {
    if let Some(raw) = upstream {
        let ct = raw.split(';').next().unwrap_or(raw).trim().to_lowercase();
        if ct.starts_with("audio/") {
            return ct;
        }
        if ct == "application/octet-stream" {
            return content_type_for(audio_url).to_string();
        }
    }
    content_type_for(audio_url).to_string()
}

/// 将 reqwest HeaderValue 转换为 axum HeaderValue
fn convert_header_value(val: &reqwest::header::HeaderValue) -> HeaderValue {
    HeaderValue::from_bytes(val.as_bytes()).unwrap_or(HeaderValue::from_static(""))
}

#[derive(Deserialize)]
struct CacheQuery {
    key: String,
}

/// 本机音频缓存文件（仅允许 audio-cache 目录内、key 合法）
async fn cache_proxy(Query(query): Query<CacheQuery>, headers: HeaderMap) -> Response {
    let key = query.key.trim();
    if key.is_empty() || key.len() > 200 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return (StatusCode::BAD_REQUEST, "Invalid cache key").into_response();
    }

    let path: PathBuf = match super::audio_cache::cache_file_path(key) {
        Ok(Some(p)) => p,
        Ok(None) => return (StatusCode::NOT_FOUND, "Cache miss").into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };

    let mut file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(e) => {
            log::warn!("[AudioProxy] cache open failed: {e}");
            return (StatusCode::NOT_FOUND, "Cache file missing").into_response();
        }
    };

    let meta = match file.metadata().await {
        Ok(m) => m,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Metadata error").into_response(),
    };
    let total = meta.len();

    let (start, end) = if let Some(range) = headers.get("range").and_then(|r| r.to_str().ok()) {
        if let Some(spec) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = spec.split('-').collect();
            if parts.len() == 2 {
                let s: u64 = parts[0].parse().unwrap_or(0);
                let e: u64 = if parts[1].is_empty() {
                    total.saturating_sub(1)
                } else {
                    parts[1].parse().unwrap_or(total.saturating_sub(1)).min(total.saturating_sub(1))
                };
                (s, e)
            } else {
                (0, total.saturating_sub(1))
            }
        } else {
            (0, total.saturating_sub(1))
        }
    } else {
        (0, total.saturating_sub(1))
    };

    let mut out_headers = HeaderMap::new();
    let ct = super::audio_cache::content_type_for_path(&path);
    out_headers.insert("Content-Type", HeaderValue::from_static(ct));
    out_headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    out_headers.insert("Accept-Ranges", HeaderValue::from_static("bytes"));

    let status = if start > 0 || end + 1 < total {
        out_headers.insert(
            "Content-Range",
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}"))
                .unwrap_or(HeaderValue::from_static("")),
        );
        out_headers.insert(
            "Content-Length",
            HeaderValue::from_str(&(end - start + 1).to_string()).unwrap_or(HeaderValue::from_static("0")),
        );
        StatusCode::PARTIAL_CONTENT
    } else {
        out_headers.insert(
            "Content-Length",
            HeaderValue::from_str(&total.to_string()).unwrap_or(HeaderValue::from_static("0")),
        );
        StatusCode::OK
    };

    if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
        log::warn!("[AudioProxy] cache seek failed: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "Seek error").into_response();
    }

    let limited = file.take(end - start + 1);
    let stream = ReaderStream::new(limited).map(|result| {
        result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    });
    let body = Body::from_stream(stream);

    let mut response = Response::new(body);
    *response.status_mut() = status;
    response.headers_mut().extend(out_headers);
    response
}

#[derive(Deserialize)]
struct LocalQuery {
    path: String,
}

fn audio_extension_ok(path: &std::path::Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("mp3" | "flac" | "wav" | "m4a" | "ogg" | "aac" | "opus")
    )
}

/// 本机音频文件。只允许已存在的音频扩展名，供本地导入播放。
async fn local_proxy(Query(query): Query<LocalQuery>, headers: HeaderMap) -> Response {
    let raw = query.path.trim();
    if raw.is_empty() || raw.starts_with("content:") {
        return (StatusCode::BAD_REQUEST, "Invalid path").into_response();
    }
    let path = match std::fs::canonicalize(raw) {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "File missing").into_response(),
    };
    if !path.is_file() || !audio_extension_ok(&path) {
        return (StatusCode::BAD_REQUEST, "Unsupported file").into_response();
    }

    let mut file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(e) => {
            log::warn!("[AudioProxy] local open failed: {e}");
            return (StatusCode::NOT_FOUND, "File missing").into_response();
        }
    };
    let meta = match file.metadata().await {
        Ok(m) => m,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Metadata error").into_response(),
    };
    let total = meta.len();
    if total == 0 {
        return (StatusCode::OK, "").into_response();
    }
    let (start, end) = if let Some(range) = headers.get("range").and_then(|r| r.to_str().ok()) {
        if let Some(spec) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = spec.split('-').collect();
            if parts.len() == 2 {
                let s: u64 = parts[0].parse().unwrap_or(0);
                let e: u64 = if parts[1].is_empty() {
                    total.saturating_sub(1)
                } else {
                    parts[1]
                        .parse()
                        .unwrap_or(total.saturating_sub(1))
                        .min(total.saturating_sub(1))
                };
                (s.min(total.saturating_sub(1)), e.max(s.min(total.saturating_sub(1))))
            } else {
                (0, total.saturating_sub(1))
            }
        } else {
            (0, total.saturating_sub(1))
        }
    } else {
        (0, total.saturating_sub(1))
    };

    let mut out_headers = HeaderMap::new();
    let ct = super::audio_cache::content_type_for_path(&path);
    out_headers.insert("Content-Type", HeaderValue::from_static(ct));
    out_headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    out_headers.insert("Accept-Ranges", HeaderValue::from_static("bytes"));
    let status = if start > 0 || end + 1 < total {
        out_headers.insert(
            "Content-Range",
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}"))
                .unwrap_or(HeaderValue::from_static("")),
        );
        out_headers.insert(
            "Content-Length",
            HeaderValue::from_str(&(end.saturating_sub(start) + 1).to_string())
                .unwrap_or(HeaderValue::from_static("0")),
        );
        StatusCode::PARTIAL_CONTENT
    } else {
        out_headers.insert(
            "Content-Length",
            HeaderValue::from_str(&total.to_string()).unwrap_or(HeaderValue::from_static("0")),
        );
        StatusCode::OK
    };
    if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
        log::warn!("[AudioProxy] local seek failed: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "Seek error").into_response();
    }
    let limited = file.take(end.saturating_sub(start) + 1);
    let stream = ReaderStream::new(limited).map(|result| {
        result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    });
    let body = Body::from_stream(stream);
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response.headers_mut().extend(out_headers);
    response
}

/// 音频代理 - 支持 Range 请求，纯流式透传（零额外开销）
async fn audio_proxy(Query(query): Query<ProxyQuery>, headers: HeaderMap) -> Response {
    let audio_url = &query.url;
    if !audio_url.starts_with("http") {
        return (StatusCode::BAD_REQUEST, "Invalid url").into_response();
    }

    let referer = referer_for(audio_url);
    // 流式传输专用 client —— 无整体超时，避免长曲目中途断开
    let client = get_stream_client();

    let mut req = client
        .get(audio_url)
        .header("User-Agent", UA)
        .header("Referer", referer);

    // 传递 Range 头 (axum -> reqwest 转换)
    if let Some(range) = headers.get("range") {
        if let Ok(range_str) = range.to_str() {
            req = req.header("Range", range_str);
        }
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[AudioProxy] request failed: {e}");
            return (StatusCode::BAD_GATEWAY, format!("Proxy error: {e}")).into_response();
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
    let mut out_headers = HeaderMap::new();

    let upstream_ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok());
    let ct = resolve_stream_content_type(upstream_ct, audio_url);
    out_headers.insert(
        "Content-Type",
        HeaderValue::from_str(&ct).unwrap_or_else(|_| HeaderValue::from_static("audio/mpeg")),
    );
    out_headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    out_headers.insert("Accept-Ranges", HeaderValue::from_static("bytes"));

    if let Some(cl) = resp.headers().get("content-length") {
        out_headers.insert("Content-Length", convert_header_value(cl));
    }
    if let Some(cr) = resp.headers().get("content-range") {
        out_headers.insert("Content-Range", convert_header_value(cr));
    }

    // 流式传输：边下边播，纯透传，零额外内存开销
    let stream = resp.bytes_stream().map(|result| {
        result.map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })
    });
    let body = Body::from_stream(stream);

    let mut response = Response::new(body);
    *response.status_mut() = status;
    response.headers_mut().extend(out_headers);
    response
}

/// 封面代理 - 添加 CORS 头
async fn cover_proxy(Query(query): Query<CoverQuery>) -> Response {
    let cover_url = &query.url;
    if !cover_url.starts_with("http") {
        return (StatusCode::BAD_REQUEST, "Invalid url").into_response();
    }

    let referer = referer_for(cover_url);
    let client = get_client();

    let resp = match client
        .get(cover_url)
        .header("User-Agent", UA)
        .header("Referer", referer)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[CoverProxy] request failed: {e}");
            return (StatusCode::BAD_GATEWAY, format!("Proxy error: {e}")).into_response();
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
    let mut out_headers = HeaderMap::new();

    let ct = resp
        .headers()
        .get("content-type")
        .map(convert_header_value)
        .unwrap_or_else(|| HeaderValue::from_static("image/jpeg"));
    out_headers.insert("Content-Type", ct);
    out_headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    out_headers.insert("Cross-Origin-Resource-Policy", HeaderValue::from_static("cross-origin"));
    out_headers.insert("Cache-Control", HeaderValue::from_static("public, max-age=86400"));

    if let Some(cl) = resp.headers().get("content-length") {
        out_headers.insert("Content-Length", convert_header_value(cl));
    }

    let body = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_GATEWAY, "Body read error").into_response(),
    };

    (status, out_headers, body).into_response()
}

/// 启动音频代理服务器，返回端口号
pub async fn start_audio_proxy() -> Result<u16, String> {
    // 如果已经在运行，直接返回端口
    let existing = PROXY_PORT.load(Ordering::Relaxed);
    if existing > 0 {
        return Ok(existing);
    }

    let app = Router::new()
        .route("/audio", get(audio_proxy))
        .route("/cache", get(cache_proxy))
        .route("/local", get(local_proxy))
        .route("/cover", get(cover_proxy));

    // 找一个可用端口
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy port: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?
        .port();

    PROXY_PORT.store(port, Ordering::Relaxed);

    tokio::spawn(async move {
        log::info!("[AudioProxy] listening on 127.0.0.1:{port}");
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("[AudioProxy] server error: {e}");
        }
    });

    Ok(port)
}

/// 设置 AppHandle 供代理服务器使用
pub fn set_app_handle(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

/// 获取当前代理端口
pub fn get_proxy_port() -> u16 {
    PROXY_PORT.load(Ordering::Relaxed)
}

/// Tauri command: 获取代理端口
#[tauri::command]
pub async fn cmd_get_proxy_port() -> Result<u16, String> {
    let port = get_proxy_port();
    if port > 0 {
        Ok(port)
    } else {
        start_audio_proxy().await
    }
}
