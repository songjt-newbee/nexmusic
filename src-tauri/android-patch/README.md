# NexMusic Android 补丁说明

`npm run tauri android init` 生成 `src-tauri/gen/android` 之后，运行：

```powershell
powershell -File scripts/patch-android.ps1
```

脚本会：

1. 拷贝 `network_security_config.xml`（允许 `127.0.0.1` / `localhost` 明文，音频代理需要）
2. `compileSdk` / `targetSdk` 设为 **36**（Android 16）
3. `usesCleartextTraffic` 占位设为 true
4. 拷贝 `MediaSessionPlugin.kt`、`PlaybackService.kt`、`CookieBridgePlugin.kt` 到应用 Java 包目录
5. Manifest 增加通知 / 前台服务权限，并注册 `PlaybackService`（`foregroundServiceType=mediaPlayback`）

`tauri android init` 若再次执行会覆盖 `gen/android`，请重新跑补丁脚本（幂等）。

第一期 Android 登录仍可用「粘贴 Cookie」。通知栏播放条在首次播放时会向系统申请通知权限。
