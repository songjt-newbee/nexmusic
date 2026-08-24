mod android_cookies;
mod catalog;
mod catalog_ai;
mod mediasession;
mod music_api;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(mediasession::init())
        .setup(|app| {
            let handle = app.handle().clone();
            music_api::audio_proxy::set_app_handle(handle.clone());
            tauri::async_runtime::spawn(async move {
                music_api::init_cookie_cache(&handle).await;
                match music_api::audio_proxy::start_audio_proxy().await {
                    Ok(port) => log::info!("[MusicAPI] audio proxy started on port {port}"),
                    Err(e) => log::error!("[MusicAPI] failed to start audio proxy: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            android_cookies::android_get_cookies,
            mediasession::media_session_update,
            mediasession::media_session_stop,
            music_api::music_search,
            music_api::music_song_url,
            music_api::music_login_qr_key,
            music_api::music_login_qr_create,
            music_api::music_login_qr_check,
            music_api::music_login_status,
            music_api::music_login_cookie,
            music_api::music_logout,
            music_api::music_user_playlist,
            music_api::music_playlist_tracks,
            music_api::music_playlist_tracks_range,
            music_api::music_playlist_info_with_track_ids,
            music_api::music_playlist_detail,
            music_api::music_likelist,
            music_api::music_like,
            music_api::music_playlist_subscribe,
            music_api::music_lyric,
            music_api::music_song_comments,
            music_api::music_send_comment,
            music_api::music_personalized,
            music_api::music_recommend_songs,
            music_api::music_recommend_resource,
            music_api::music_simi_song,
            music_api::music_artist_search,
            music_api::music_artist_songs,
            music_api::music_artist_detail,
            music_api::music_artist_albums,
            music_api::music_artist_mvs,
            music_api::music_album_detail,
            music_api::music_mv_url,
            music_api::music_playlist_search,
            music_api::music_open_login_window,
            music_api::kugou_search,
            music_api::kugou_artist_search,
            music_api::kugou_playlist_search,
            music_api::kugou_artist_songs,
            music_api::kugou_song_url,
            music_api::kugou_lyric,
            music_api::kugou_login_status,
            music_api::kugou_login_cookie,
            music_api::kugou_logout,
            music_api::kugou_user_playlists,
            music_api::kugou_playlist_tracks,
            music_api::kugou_playlist_tracks_range,
            music_api::kugou_guess_like,
            music_api::kugou_rank_list,
            music_api::kugou_rank_songs,
            music_api::kugou_like_toggle,
            music_api::kugou_liked_hashes,
            music_api::qq_search,
            music_api::qq_song_url,
            music_api::qq_lyric,
            music_api::qq_login_status,
            music_api::qq_login_cookie,
            music_api::qq_logout,
            music_api::qq_user_playlists,
            music_api::qq_playlist_tracks,
            music_api::qq_playlist_tracks_range,
            music_api::qq_artist_search,
            music_api::qq_artist_songs,
            music_api::qq_playlist_search,
            music_api::qq_rank_list,
            music_api::qq_rank_songs,
            music_api::music_qq_recommend_playlists,
            music_api::qq_liked_hashes,
            music_api::qq_like_toggle,
            music_api::music_get_login_statuses,
            music_api::music_switch_provider,
            music_api::music_get_playback_source,
            music_api::audio_proxy::cmd_get_proxy_port,
            catalog::catalog_load,
            catalog::catalog_save,
            catalog::catalog_has_deepseek_key,
            catalog::catalog_set_deepseek_key,
            catalog_ai::catalog_ai_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
