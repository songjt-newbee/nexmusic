use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::catalog::load_deepseek_key;

const DEEPSEEK_URL: &str = "https://api.deepseek.com/chat/completions";
const MODEL: &str = "deepseek-v4-flash";

#[derive(Debug, Deserialize)]
pub struct AiSongIn {
    pub key: String,
    pub name: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiSongOut {
    pub key: String,
    pub language: String,
    pub artist_country: String,
    pub music_type: String,
    #[serde(default)]
    pub artist_gender: String,
    #[serde(default)]
    pub styles: Vec<String>,
}

#[tauri::command]
pub async fn catalog_ai_tag(app: AppHandle, songs: Vec<AiSongIn>) -> Result<Vec<AiSongOut>, String> {
    if songs.is_empty() {
        return Ok(vec![]);
    }
    if songs.len() > 20 {
        return Err("每批最多 20 首".into());
    }

    let api_key = load_deepseek_key(&app)?;
    let payload = songs
        .iter()
        .map(|s| {
            json!({
                "key": s.key,
                "name": s.name,
                "artist": s.artist,
                "album": s.album,
            })
        })
        .collect::<Vec<_>>();

    let system = "你是音乐元数据标注助手。只根据歌名、歌手、专辑判断标签。\
必须返回 JSON 对象：{\"items\":[...]}。每个 item 字段：\
key(原样回传), language(华语/英语/日语/韩语/其他), \
artistCountry(中国/美国/日本/韩国/英国/其他), \
musicType(歌曲/纯音乐/古典), \
artistGender(男/女/组合/未知，看不准就用未知), \
styles(1到3个，取值：流行,摇滚,民谣,电子,爵士,轻音乐,古风,说唱,R&B,影视,动漫,古典)。\
不确定就用最接近的值，不要输出 markdown。";

    let user = format!("请标注这些歌曲：{}", serde_json::to_string(&payload).unwrap_or_default());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let (status, text) = post_deepseek(&client, &api_key, &system, &user, true).await?;
    let (status, text) = if status.as_u16() == 400 {
        post_deepseek(&client, &api_key, &system, &user, false).await?
    } else {
        (status, text)
    };

    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("DeepSeek Key 无效".into());
        }
        if status.as_u16() == 402 || text.contains("Insufficient Balance") {
            return Err("DeepSeek 余额不足".into());
        }
        return Err(format!("DeepSeek 返回 HTTP {}", status.as_u16()));
    }

    let envelope: Value = serde_json::from_str(&text).map_err(|_| "DeepSeek 响应不是 JSON".to_string())?;
    let content = envelope
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if content.is_empty() {
        return Err("DeepSeek 没有返回内容".into());
    }

    parse_ai_items(content)
}

async fn post_deepseek(
    client: &reqwest::Client,
    api_key: &str,
    system: &str,
    user: &str,
    disable_thinking: bool,
) -> Result<(reqwest::StatusCode, String), String> {
    let mut body = json!({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        "temperature": 0.3,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"}
    });
    if disable_thinking {
        body["thinking"] = json!({"type": "disabled"});
    }
    let resp = client
        .post(DEEPSEEK_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("DeepSeek 请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    Ok((status, text))
}

fn parse_ai_items(content: &str) -> Result<Vec<AiSongOut>, String> {
    let json_text = extract_json(content);
    let value: Value = serde_json::from_str(&json_text).map_err(|_| "无法解析标注 JSON".to_string())?;
    let arr = if let Some(items) = value.get("items").and_then(|v| v.as_array()) {
        items.clone()
    } else if let Some(songs) = value.get("songs").and_then(|v| v.as_array()) {
        songs.clone()
    } else if value.is_array() {
        value.as_array().cloned().unwrap_or_default()
    } else {
        return Err("标注结果缺少 items 数组".into());
    };

    let mut out = Vec::new();
    for item in arr {
        let key = item
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if key.is_empty() {
            continue;
        }
        let styles = item
            .get("styles")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        out.push(AiSongOut {
            key,
            language: str_field(&item, &["language", "lang"]).unwrap_or_else(|| "未知".into()),
            artist_country: str_field(&item, &["artistCountry", "artist_country", "country"])
                .unwrap_or_else(|| "未知".into()),
            music_type: str_field(&item, &["musicType", "music_type", "type"]).unwrap_or_else(|| "未知".into()),
            artist_gender: str_field(&item, &["artistGender", "artist_gender", "gender"])
                .unwrap_or_else(|| "未知".into()),
            styles,
        });
    }
    Ok(out)
}

fn str_field(item: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = item.get(*k).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub async fn catalog_translate_lyric(app: AppHandle, lines: Vec<String>) -> Result<Vec<String>, String> {
    if lines.is_empty() {
        return Ok(vec![]);
    }
    if lines.len() > 120 {
        return Err("歌词太长".into());
    }
    let api_key = load_deepseek_key(&app)?;
    let system = "你是歌词翻译。把每一行歌词翻译成简体中文。\
必须返回 JSON：{\"lines\":[...]}。lines 长度必须和输入相同，顺序一致。\
空字符串仍回空字符串。不要加序号、时间轴或解释。";
    let user = format!(
        "请翻译这些歌词行：{}",
        serde_json::to_string(&lines).unwrap_or_else(|_| "[]".into())
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let (status, text) = post_deepseek(&client, &api_key, &system, &user, true).await?;
    let (status, text) = if status.as_u16() == 400 {
        post_deepseek(&client, &api_key, &system, &user, false).await?
    } else {
        (status, text)
    };
    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("DeepSeek Key 无效".into());
        }
        if status.as_u16() == 402 || text.contains("Insufficient Balance") {
            return Err("DeepSeek 余额不足".into());
        }
        return Err(format!("DeepSeek 返回 HTTP {}", status.as_u16()));
    }
    let envelope: Value = serde_json::from_str(&text).map_err(|_| "DeepSeek 响应不是 JSON".to_string())?;
    let content = envelope
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if content.is_empty() {
        return Err("DeepSeek 没有返回内容".into());
    }
    let parsed: Value = serde_json::from_str(&extract_json(content)).map_err(|_| "无法解析译文 JSON".to_string())?;
    let arr = parsed
        .get("lines")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "译文缺少 lines".to_string())?;
    if arr.len() != lines.len() {
        return Err("译文行数和原文不一致".into());
    }
    Ok(arr
        .iter()
        .map(|v| v.as_str().unwrap_or("").trim().to_string())
        .collect())
}

fn extract_json(content: &str) -> String {
    let trimmed = content.trim();
    if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        let after = after.strip_prefix("json").unwrap_or(after);
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if end > start {
                return trimmed[start..=end].to_string();
            }
        }
    }
    if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            if end > start {
                return trimmed[start..=end].to_string();
            }
        }
    }
    trimmed.to_string()
}
