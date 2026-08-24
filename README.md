# NexMusic

独立音乐播放器，从 [NexBox](https://github.com/MuLiuSaMa/NexBox) 的 `music_api` 拆出：网易云 / 酷狗 / QQ 音乐登录、歌单、播放与本地音频代理。

许可证：**GPL-3.0**（与 NexBox 相同）。

## 功能（第一期）

- 手机端深色 UI：底部「我的 / 搜索 / 分类」
- **我的**：只显示「我喜欢」和收藏歌单（无发现、榜单、推荐）
- **分类**：本机缓存「我喜欢」，按语言/类型/风格筛选播放；可同步、导出、AI 标注（见 [doc/分类标签.md](doc/分类标签.md)）
- 搜索歌曲并播放
- 迷你播放条 + 全屏封面/歌词
- 桌面用 WebView 官方登录；Android 可用粘贴 Cookie（CookieManager 插件见 `src-tauri/android-patch`）

## 桌面开发

需要 **Node.js 20+**、Rust（[rustup](https://rustup.rs)）和 VS 2022 C++ Build Tools。详见 [doc/开发环境.md](doc/开发环境.md)、[doc/家里电脑接手.md](doc/家里电脑接手.md)。

```bash
npm install
npm run tauri dev
```

桌面窗口按手机比例（390×844）预览。Vite 开发端口是 **5173**（不要用浏览器打开该地址测登录/播放，见 [doc/运行与打包.md](doc/运行与打包.md)）。

其他说明：[doc/登录窗口.md](doc/登录窗口.md)、[doc/分类标签.md](doc/分类标签.md)。

## 打包 Android 16（targetSdk 36）

代码已包含通知栏播放条（前台服务 + MediaSession）。**编译 APK 必须在你这台电脑上做**，需要先装好下面环境。

### 你需要安装的环境和版本

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | **20.11+**（20 LTS） | 与桌面开发相同 |
| Rust / rustup | rustc **≥ 1.77** | 再执行：`rustup target add aarch64-linux-android` |
| JDK | **17**（Temurin / Oracle 17，不要用 21 当默认 `JAVA_HOME`） | 设 `JAVA_HOME` 指向 JDK 17 |
| Android Studio | 当前稳定版即可 | 用 SDK Manager 装下列组件 |
| Android SDK Platform | **36**（Android 16） | SDK Manager → SDK Platforms |
| Android SDK Build-Tools | **36.x** | SDK Manager → SDK Tools |
| NDK | **28**（或 27+） | 28+ 更利于 16KB 页对齐；记下安装目录 |
| Android SDK Command-line Tools | 最新 | 含 `sdkmanager` / 配合 Tauri |
| 平台工具 | 最新 `platform-tools` | 提供 `adb` |

环境变量（用户或系统均可）：

- `JAVA_HOME`：JDK 17 根目录
- `ANDROID_HOME`：SDK 根目录，例如 `%LOCALAPPDATA%\Android\Sdk`
- `NDK_HOME`：例如 `%LOCALAPPDATA%\Android\Sdk\ndk\28.x.x`
- `Path` 增加：`%ANDROID_HOME%\platform-tools`、`%JAVA_HOME%\bin`、Cargo、Node 20

手机：Android 16 即可测；打开开发者选项 + USB 调试。首次播放时允许「通知」权限，下拉通知栏才会出现播放条。

### 本机命令

```powershell
# PATH 需包含 Node 20 与 Cargo
npm run tauri android init
powershell -File scripts/patch-android.ps1

# USB 连着手机时（推荐迭代）
npm run tauri android dev -- --target aarch64

# 生成可拷贝的 debug APK
npm run tauri android build -- --debug --target aarch64
```

APK 一般在 `src-tauri/gen/android/app/build/outputs/apk/` 下（以 Gradle 实际输出为准），然后：

```powershell
adb install -r <apk路径>
```

`src-tauri/gen/` 不要提交 Git。若再次 `android init`，请重新跑 `patch-android.ps1`。

音频走 `http://127.0.0.1` 本地代理，补丁会允许 localhost 明文。登录可粘贴 Cookie。

## 目录

- `src/` React 手机 UI
- `src-tauri/src/music_api/` 从 NexBox 拷贝的平台 API + `audio_proxy`
- `src-tauri/android-patch/` Android 16 / 明文流量 / 通知栏播放条补丁

登录 Cookie 保存在应用本地 store（`music-cookies.json`），「我喜欢」缓存为 `nexmusic-liked-cache.json`，请自行保管。分类说明见 [doc/分类标签.md](doc/分类标签.md)。
