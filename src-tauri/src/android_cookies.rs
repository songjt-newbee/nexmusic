/// Android WebView CookieManager 桥。
/// 桌面端登录走 WebView 窗口轮询 cookies()；Android 上该 API 不可用，
/// 由 Kotlin CookieManager（android init 后接入）读取。
#[tauri::command]
pub fn android_get_cookies(url: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = url;
        Err("请在 tauri android init 后接入 CookieManager 插件（见 README）".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = url;
        Err("desktop uses webview cookies".into())
    }
}
