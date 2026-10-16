# 系统播放胶囊与锁屏展示

## 系统流体云的正确含义

用户所指为应用退到后台后显示在系统顶部的播放胶囊，点击展开封面、进度和播放控制卡片。目标设备为 OPPO Find X8 / ColorOS 16.0.7。现已接入 Android 标准 MediaSession 与关联的系统媒体通知，等待在该手机上验证顶部胶囊与展开卡片。没有拿到 OPPO 对自定义应用包名展示的保证；不能将资源编译通过等同于系统胶囊已显示。原先误做的云雾动画与自动融合代码已删除。

## 音乐胶囊代码与打包

- 原生文件：`src/uni_modules/wuyu-media-session/utssdk/app-android/WuyuMediaBridge.kt`；UTS 入口为同目录 `index.uts`。
- 封面仅从本地文件、content URI 或已有 data URL 读取，缩采样至最长边不超过 512 像素；后台解码，换曲时立即清除旧图，过期结果不回写。
- 标准媒体会话提供歌名、歌手、专辑、封面、时长和播放位置；播放状态带 elapsedRealtime 时间戳，进度同步节流至约一秒，拖动立即同步。
- 系统播放、暂停、上一首、下一首、停止、拖动进度、喜欢操作通过持续 UTS 回调接回现有播放器。
- 前台服务类型为 `mediaPlayback`，权限和服务声明由插件 AndroidManifest 合并。不请求悬浮窗、无障碍权限，不调用未验证的 OPPO 私有字段或伪造其他应用包名。
- `npm run build:app` 生成 UTS 对应 Kotlin / Swift 及 App 资源。新增服务声明后需用 HBuilderX **重新制作自定义基座或重新打包 APK**，仅热更新 JS / WGT 不能添加服务；旧标准基座可能降级为普通通知。
- H5 继续使用浏览器 MediaSession；网页内不模拟顶部系统胶囊。

### Find X8 联调顺序

1. 安装带该原生模块及合并 manifest 的新基座 / APK；使用实际应用包名，不能以其他播放器包名冒充。
2. 播放带封面的本地歌曲，进入“音乐库管理 → 后台播放与系统控制 → 刷新播放状态”，应显示“系统媒体会话已启动”。
3. 上滑回桌面（不是划掉最近任务或强制停止），观察顶部胶囊；点击胶囊检查卡片封面、进度及三个播放按钮。
4. 如有通知卡片但没有胶囊，先在系统设置搜索“流体云”，核对该系统版本的音乐播放提示开关；保留应用包名、系统版本及截图，进一步确认厂商适配范围，不能将 MediaSession 当成绕过系统展示策略的接口。
5. 连接 USB 调试后执行 `adb shell dumpsys media_session`，确认当前包名的 WuyuMusic 会话处于 active、状态和进度正确；分别验证暂停、切歌、拖动、锁屏、断开耳机和返回应用。

## 当前可用

- 更多 → 进入锁屏展示：应用内全屏时钟、日期、当前歌曲和封面粒子；播放时每约 24 秒在封面和“雾屿音乐”之间变化。轻点粒子唤出控制，4.5 秒后隐藏；退出按钮始终可用，Esc / Android 返回键可退出。
- 常亮默认关闭，由用户手动开启；退到后台释放，返回前台恢复，退出展示后释放。常亮不关闭系统锁屏，也不提升解锁权限。
- 页面不可见、歌词页、设置面板打开或应用后台时停止画布循环。减少动态效果设置下不循环运动，手动切换直接完成。

## 系统锁屏：当前边界

已新增原生 `WuyuParticleWallpaperService`，与网页 / 应用内展示独立。APK 注册该服务并经用户在系统预览确认应用后，Android 可以在系统锁屏背景绘制粒子。没有增加自绘时钟、解锁界面或覆盖系统窗口。ColorOS 是否允许只应用到锁屏，仍需在 Find X8 的系统预览中确认。
系统媒体控件由 `system-controls.js` 优先调用本地 UTS 模块 `src/uni_modules/wuyu-media-session`。原生服务发布 framework MediaSession、MediaMetadata、PlaybackState，以及绑定 session token 的 MediaStyle 通知；播放与音频焦点仍由原有 BackgroundAudioManager 管理，模块不播放第二路音频。原生模块不可用时降级到旧通知，并在“后台播放与系统控制”显示原因。

## 系统粒子动态壁纸（已实现）

入口：播放页 → 更多 → **设为锁屏粒子壁纸**（Android App 专有）。它打开系统动态壁纸预览，系统提供“锁屏”或“桌面与锁屏”等可用选项，由用户确认；应用不直接替换现有壁纸。

### 代码与行为

- `WuyuParticleWallpaperService.kt`：系统绑定的 WallpaperService / Engine，使用原生 Surface Canvas 绘制。封面、球体、星环、“雾屿音乐”每约 24 秒变形，保留系统时钟、通知和解锁。
- `WuyuWallpaperState.kt`：同进程的播放状态与视觉数据共享，封面和分析包络通过 AtomicFile 在私有目录保存。进程冷启动只恢复静态视觉数据，不恢复“正在播放”标记。
- `WuyuMediaBridge.kt`：同步当前歌曲的稳定 audioKey、播放时间、暂停状态及本地封面采样。实际播放仍由既有 BackgroundAudioManager 负责。
- `ParticleCover.vue` / `cover-particles.js`：将已经分析的 RMS / 低频包络传给原生模块，最长支持与现有分析相同的 120000 个采样点，按歌曲标识匹配，拒绝过期结果。不再解码音频、不使用麦克风、不上传文件。
- 首次未完成音频分析、歌曲过大或解码失败时，仍有舒缓呼吸；在应用中打开一次播放页可准备音乐包络。
- 缓慢呼吸与低频扩张可同步现有“呼吸强度”设置。暂停后平滑收回；系统减少动画时不循环运动。
- 锁屏可见且屏幕亮起时约 24 fps / 1400 点；省电模式约 15 fps / 850 点。息屏、Surface 销毁和壁纸不可见时移除绘制回调。
- Android 14+ 通过 wallpaper flags 区分应用范围，同时检查锁定状态。若壁纸也应用到桌面，解锁后显示静态粒子，不在桌面持续运行动画。系统允许传递触摸事件时可以拖动旋转。
- 插件 manifest 的 BIND_WALLPAPER 是系统绑定服务所要求的权限，不向用户申请悬浮窗或无障碍权限。资源包含系统可识别的 XML 描述、缩略图和文案。

### 安装使用

1. 重新制作包含更新后的 UTS 原生模块及服务清单的自定义基座，或重新打包完整 APK；只更新 JS / WGT 无法注册新服务。
2. 播放一首有封面的本地歌曲，打开播放页等待音乐分析完成。
3. 打开“视觉设置 → 设为锁屏粒子壁纸”，在系统预览确认可用的应用范围。
4. 返回桌面并锁屏，点亮屏幕后观察粒子背景。完全息屏时不绘制，不接管 AOD。
5. 在系统壁纸设置选择其他壁纸即可停用。原应用内“进入锁屏展示”仍是独立入口。

尚未连接 Find X8，APK 安装、ColorOS 锁屏应用范围、手势投递和实际帧率 / 耗电尚未验证；不能把编译结果当作真机通过。

## 待真机检查

- 切换歌词、收起播放页、退到后台后停止绘制；重开无需重新读取封面。
- 展示页常亮、熄屏、回前台、Android 返回退出，退出后不残留常亮。
- 华为 / 小米 / OPPO / vivo / 三星系统壁纸预览的锁屏选项及系统媒体控件。

## 官方依据

- [Android WallpaperService](https://developer.android.com/reference/android/service/wallpaper/WallpaperService)
- [WallpaperService.Engine 生命周期与 wallpaper flags](https://developer.android.com/reference/android/service/wallpaper/WallpaperService.Engine)
- [Uni-app 屏幕亮度与 setKeepScreenOn](https://uniapp.dcloud.net.cn/api/system/brightness.html)
- [浏览器 Screen Wake Lock 生命周期与释放](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)

- [Android MediaSession](https://developer.android.com/reference/android/media/session/MediaSession)
- [Android MediaStyle 与 session token](https://developer.android.com/reference/android/app/Notification.MediaStyle)
- [Android mediaPlayback 前台服务](https://developer.android.com/develop/background-work/services/fgs/service-types#media)
- [DCloud UTS / Kotlin 混编与服务清单](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-plugin-hybrid.html)
- [OPPO 流体云设置项（不可据此推断音乐应用都自动获得展示）](https://open.oppomobile.com/new/developmentDoc/info?id=13330)

## 本次检查记录

- H5 资源构建通过。
- App 资源构建与 UTS → Kotlin / Swift 代码生成通过；不等于 APK 完整打包通过。
- 使用 Kotlin 2.1.20 与本机 Android API 34 的 android.jar，原生 Kotlin 文件联合编译通过，仅有兼容旧 Android API 的弃用警告。
- 已找到 D:/andriodSDK/platform-tools/adb.exe，adb devices 没有设备，尚未执行 Find X8 真机胶囊检查。

- 本次新增壁纸资源经 Android AAPT2 compile / link 检查通过，App 产物包含服务清单、Kotlin 源码与 res 资源。检查生成的临时 APK 只含资源，不是可安装的完整应用。


## 文字及运行状态同步更新

- `setWallpaperText(json)` 接收最多 8 句文字和字体 / 排版，与应用内视觉设置同步；默认“雾屿音乐”，文字形态在轮换中逐句展示。
- 壁纸缓存升级为版本 3，兼容读取版本 2；新增文字、字体和排版，即使尚无封面也可保存设置。
- `WuyuDeviceState.kt` 提供通知、电池优化、省电及温控诊断和系统设置入口。仅读取本机状态，不采集上传。
- 温控中度时使用省电粒子预算；严重温控停止自动流动，监听温度恢复重新调度。省电不影响音频播放。
- 官方接口依据：[Android PowerManager](https://developer.android.com/reference/android/os/PowerManager)。
