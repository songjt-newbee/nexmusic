use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use serde::Serialize;
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
struct MediaAndroid<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaPayload {
    title: String,
    artist: String,
    cover: String,
    playing: bool,
    duration_ms: u64,
    position_ms: u64,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mediasession")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("top.nexmusic.app", "MediaSessionPlugin")?;
                app.manage(MediaAndroid(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

#[tauri::command]
pub fn media_session_update<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    artist: String,
    cover: String,
    playing: bool,
    duration_ms: u64,
    position_ms: u64,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<MediaAndroid<R>>() else {
            return Ok(());
        };
        plugin
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "update",
                MediaPayload {
                    title,
                    artist,
                    cover,
                    playing,
                    duration_ms,
                    position_ms,
                },
            )
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, title, artist, cover, playing, duration_ms, position_ms);
    }
    Ok(())
}

#[tauri::command]
pub fn media_session_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let Some(plugin) = app.try_state::<MediaAndroid<R>>() else {
            return Ok(());
        };
        plugin
            .0
            .run_mobile_plugin::<serde_json::Value>("stop", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}
