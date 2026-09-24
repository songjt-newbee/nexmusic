#![allow(dead_code)]

use serde::Deserialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
struct CookieAndroid<R: Runtime>(PluginHandle<R>);

#[derive(Deserialize, Default)]
struct CookieRet {
    cookie: Option<String>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("cookiebridge")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("top.nexmusic.app", "CookieBridgePlugin")?;
                app.manage(CookieAndroid(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

pub fn open_login_overlay<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<CookieAndroid<R>>() else {
            return Err("CookieBridge 未注册，请运行 scripts/patch-android.ps1".into());
        };
        plugin
            .0
            .run_mobile_plugin::<serde_json::Value>("openLogin", serde_json::json!({ "url": url }))
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, url);
        Err("desktop uses webview login window".into())
    }
}

pub fn navigate_login_overlay<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<CookieAndroid<R>>() else {
            return Ok(());
        };
        let _ = plugin
            .0
            .run_mobile_plugin::<serde_json::Value>("navigateLogin", serde_json::json!({ "url": url }));
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, url);
        Ok(())
    }
}

pub fn close_login_overlay<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<CookieAndroid<R>>() else {
            return Ok(());
        };
        let _ = plugin
            .0
            .run_mobile_plugin::<serde_json::Value>("closeLogin", serde_json::json!({}));
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

pub fn get_cookies<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<CookieAndroid<R>>() else {
            return Ok(String::new());
        };
        let ret = plugin
            .0
            .run_mobile_plugin::<CookieRet>("getCookies", serde_json::json!({ "url": url }))
            .map_err(|e| e.to_string())?;
        return Ok(ret.cookie.unwrap_or_default());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, url);
        Err("desktop uses webview cookies".into())
    }
}

#[tauri::command]
pub fn android_get_cookies<R: Runtime>(app: AppHandle<R>, url: String) -> Result<String, String> {
    get_cookies(&app, &url)
}

#[tauri::command]
pub fn android_close_login<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    close_login_overlay(&app)
}

#[tauri::command]
pub fn android_leave_app<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<CookieAndroid<R>>() else {
            return Ok(());
        };
        let _ = plugin
            .0
            .run_mobile_plugin::<serde_json::Value>("leaveApp", serde_json::json!({}));
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub fn android_handle_back<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<CookieAndroid<R>>() else {
            return Ok(false);
        };
        #[derive(Deserialize, Default)]
        struct BackRet {
            handled: Option<bool>,
        }
        let ret = plugin
            .0
            .run_mobile_plugin::<BackRet>("handleBack", serde_json::json!({}))
            .unwrap_or_default();
        return Ok(ret.handled.unwrap_or(false));
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(false)
    }
}
