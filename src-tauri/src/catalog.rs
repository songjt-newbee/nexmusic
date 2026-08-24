use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "nexmusic-liked-cache.json";
const DATA_KEY: &str = "data";
const KEY_KEY: &str = "deepseek_key";

fn empty_cache() -> Value {
    json!({
        "version": 1,
        "syncedAt": {},
        "songs": []
    })
}

#[tauri::command]
pub fn catalog_load(app: AppHandle) -> Result<Value, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store.get(DATA_KEY).unwrap_or_else(empty_cache))
}

#[tauri::command]
pub fn catalog_save(app: AppHandle, data: Value) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(DATA_KEY, data);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn catalog_has_deepseek_key(app: AppHandle) -> Result<bool, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store
        .get(KEY_KEY)
        .and_then(|v| v.as_str().map(|s| !s.trim().is_empty()))
        .unwrap_or(false))
}

#[tauri::command]
pub fn catalog_set_deepseek_key(app: AppHandle, key: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        store.delete(KEY_KEY);
    } else {
        store.set(KEY_KEY, trimmed);
    }
    store.save().map_err(|e| e.to_string())
}

pub fn load_deepseek_key(app: &AppHandle) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let key = store
        .get(KEY_KEY)
        .and_then(|v| v.as_str().map(|s| s.trim().to_string()))
        .unwrap_or_default();
    if key.is_empty() {
        Err("尚未保存 DeepSeek API Key".into())
    } else {
        Ok(key)
    }
}
