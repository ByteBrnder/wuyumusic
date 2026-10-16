# 雾屿系统媒体会话

Android UTS / Kotlin 本地模块；不引入第三方 SDK，不额外播放音频。现有 BackgroundAudioManager 负责实际播放，模块只将其状态和控制接入 Android MediaSession。

## 接入

```js
import { onMediaAction, publishMedia, updateMediaPosition, getMediaStatus, releaseMedia } from '@/uni_modules/wuyu-media-session'
```

- `onMediaAction(callback)`：持续接收 `play / pause / stop / previous / next / seek / favorite / like / unlike`，seek 参数单位秒。
- `publishMedia(metadataJson, playing, positionSeconds, durationSeconds)`：同步当前歌，首次播放时启动媒体前台服务。元数据字段为 `id / title / artist / album / cover / favorite`。
- `updateMediaPosition(positionSeconds, durationSeconds)`：同步进度，原生约一秒节流，明显跳转直接更新。
- `getMediaStatus()`：返回可用性、服务状态、设备信息、启动错误的 JSON。服务已启动不代表系统已经展示流体云。
- `releaseMedia()`：清理会话、通知及回调。再次使用需重新注册 `onMediaAction`。

## 构建与限制

HBuilderX 4.25+，本项目使用匹配版本的 `@dcloudio/uni-uts-v1`。Android 最低 API 21，manifest 声明了 `mediaPlayback` 服务类型及对应前台服务权限。新增 / 修改服务清单后必须重新制作自定义基座或打包 APK，资源热更新无法完成原生服务注册。

iOS 入口为空实现，继续沿用现有后台音频逻辑；H5 不导入此模块。

模块提供系统音乐卡片所需的标准媒体数据；顶部胶囊、展开方式和应用适配范围由设备系统决定，尚未完成真机验证，不保证厂商流体云展示。

这里的前台服务托管会话，不接管音频引擎，也不保证进程被系统终止后能恢复音频。

## 系统粒子动态壁纸

- `openParticleWallpaper()`：打开当前 Activity 的系统动态壁纸预览；空字符串表示预览已启动，非空字符串为错误信息。最终是否应用、应用到哪个屏幕，由系统 UI 决定。
- `setWallpaperEnvelope(json)`：异步接收 `{key, rate:40, duration, values, low}`；归一化值必须处于 0～1，最多 120000 个点。按当前 audioKey 匹配，过期数据不覆盖当前曲目。
- `setWallpaperIntensity(intensity)`：0～1，对应应用内 0～100% 呼吸强度。

新增 `WuyuParticleWallpaperService` 与 XML 壁纸描述，需要重新制作自定义基座 / 完整 APK。1400 点 / 24fps，省电模式 850 点 / 15fps；息屏停绘，冷启动静态恢复，不自动播放音频。不同系统的锁屏应用选项仍待真机验证。


新增接口：
- `setWallpaperText(json)`：`{customTexts:string[], textFont:'sans'|'serif'|'mono', textLayout:'stack'|'line'}`。最多 8 句，每句最多 12 个 Unicode 字符。
- `getDeviceStatus()`：返回本机通知、省电、温度等级、电池优化及媒体会话状态 JSON。
- `openDeviceSettings(kind)`：`notifications` / `battery` / `app`。打开系统设置，空字符串表示启动成功；不更改系统权限。

壁纸缓存 v3 兼容 v2。温控恢复通过系统监听器调度；不可见时不绘制。原生更新需重新打包。
