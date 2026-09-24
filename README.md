# NexMusic

独立音乐播放器。平台接口从 [NexBox](https://github.com/MuLiuSaMa/NexBox) 的 `music_api` 拆出，当前界面使用 **QQ 音乐** 登录和歌单，播放走本机音频代理。听歌记录、分类标签和播放状态都写在本机，不回传播放次数。

许可证：**GPL-3.0**（与 NexBox 相同）。

底部四个页：**我的 / 搜索 / 分类 / 设置**。深色界面，桌面窗口按手机比例预览。

## 我的

只放收藏和本机内容，没有发现、榜单或推荐。

- **我喜欢**和其他已收藏歌单。我喜欢优先读本机缓存，可以超过接口单次返回的条数，并按添加时间、歌名、歌手或播放次数排序。
- **本地音乐**：导入 mp3、flac、wav、m4a、ogg、aac、opus。桌面直接用原路径播放；Android 会拷进应用目录。
- **最近播放**：本机最近听过的 100 首，最新在前。
- 打开任意一个列表后，可以按歌名、歌手、专辑或分类标签再筛一次。**播放全部**会清空当前队列和「下一首」，把此刻列表里显示的歌放进去并从第一首开始播。列表是空的只提示，不清正在播的队列。
- 我喜欢和本地音乐显示「听过 N 次」。次数只在本机累加，QQ 收藏里的个人收听次数拿不到。

## 搜索

按当前平台搜索歌曲。歌名或歌手能对上「我喜欢」或本地音乐时，本机那一首排在前面，并保留播放次数和本地路径；同一首不会在后面的在线结果里再出现。平台搜索失败时，仍然显示这些本机命中。

## 分类

「我喜欢」同步到本机后，按语言、国家、类型、歌手性别和风格筛选。筛选项可收起。歌曲列表里还可以按歌名、歌手、专辑或这些标签再搜一次。

标签来源：

- **规则猜测**：不联网，用歌名和歌手字符串填空着的字段。
- **AI 标注**：用本机保存的 DeepSeek Key，模型 `deepseek-v4-flash`，只填还没标过的歌。手工改过的标签不会被覆盖。
- 铅笔按钮可手工改标签。

同步、导出和导入的细节见 [doc/分类标签.md](doc/分类标签.md)。DeepSeek Key 在「设置」里保存，导出文件不含 Key。

## 设置

- **同类随机**：只在随机播放时生效。相同歌手、相同性别（双方都不是「未知」）各加 4 分；有共同风格标签，或语言相同且都不是「未知」，各加 3 分。没有可用标签时退回均匀随机。最近听过的歌会降权，但不会被完全排除。
- **定时关闭**：15 / 30 / 60 / 90 分钟后暂停，或当前列表自然播完后暂停，或再自然播完 N 首后暂停。手动切歌不计入这 N 首。到点只暂停并停止自动切歌，不退出应用。
- **播完后缓存到本机**：整首播完才下载。
- 分类数据的导入、导出，以及 DeepSeek API Key。

## 播放

迷你条和全屏播放页都可以控制上一首、播放暂停、下一首、播放顺序和播放列表。

- 播放顺序、当前歌曲和队列会记住。下次打开停在上次那一首，不自动开播。
- 顺序播放按队列下标前进。随机播放时，上一首回到刚才听过的歌；进度超过 3 秒时，上一首只把当前这首从头再放。
- 列表和队列里可以「下一首播放」。这些歌会排在自动切歌之前。
- 播放列表可拖动排序，靠近上下边缘会自动滚动，打开时定位到正在播的那一首。过滤后拖动仍用原来的队列位置。
- 音量只作用于应用内播放，不改系统音量。竖条在全屏页右上角，闲置约 2 秒或点到别处会收起。
- 歌词在封面上点一下展开。外文歌优先用接口自带译文；没有译文且不是华语时，用 DeepSeek 译成中文并缓存在本机。
- 全屏页底部从左到右：最近 20 首、歌曲详情、上一首、播放暂停、下一首、播放顺序、播放列表。详情里可看歌手、专辑和分类；点歌手、专辑、某一种风格或语言，会列出我喜欢里对得上的歌。

桌面用 WebView 打开官方登录。Android 可粘贴 Cookie，通知栏播放条见 `src-tauri/android-patch`。

## 桌面开发

需要 **Node.js 20+**、Rust（[rustup](https://rustup.rs)）和 VS 2022 C++ Build Tools。详见 [doc/开发环境.md](doc/开发环境.md)、[doc/家里电脑接手.md](doc/家里电脑接手.md)。

```bash
npm install
npm run tauri dev
```

桌面窗口按手机比例（390×844）预览。Vite 开发端口是 **4173**（不要用浏览器打开该地址测登录/播放，见 [doc/运行与打包.md](doc/运行与打包.md)）。

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

- `src/` React 界面。播放状态在 `src/stores/music-store.ts`，分类缓存在 `src/stores/catalog-store.ts`
- `src-tauri/src/music_api/` 平台 API、音频代理和播后缓存
- `src-tauri/src/local_audio.rs` 本地文件导入
- `src-tauri/android-patch/` Android 16 / 明文流量 / 通知栏播放条补丁

登录 Cookie 在应用本地 store（`music-cookies.json`）。「我喜欢」和分类标签在 `nexmusic-liked-cache.json`，Windows 上位于 `%AppData%\top.nexmusic.app\`。播放队列、播放次数、最近播放和音量写在本机浏览器存储里。这些都不要提交到 Git。
