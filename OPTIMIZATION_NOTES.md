# 本轮优化交付记录

## 已实现

1. 后台播放：增加本机通知、电池优化、省电、温控和媒体会话诊断；提供系统设置入口、诊断复制；修复原生会话分支跳过通知权限请求的问题。
2. 导入：音频先提交并可播放，标签 / 封面 / 歌词后台串行补全；处理状态持久化，重启继续；解析失败不删除音频，避免覆盖手动编辑；保留取消、去重与失败重试。
3. 粒子：按绘制耗时和实际帧间隔降级，稳定后逐步恢复；安卓省电或中度温控降低预算，严重温控暂停自动运动，冷却后重新调度。不可见停止绘制。
4. 歌词：候选版本预览后应用、偏移重置、手动滚动中止自动滚动并支持恢复跟随；既有 LRC 导入和每曲偏移保留。
5. 音乐库：多选收藏 / 加入歌单 / 移除，歌单改名和歌曲排序；歌曲列表重排，标题与歌手分行；移除明确保留手机原始文件。
6. 粒子文字：最多 8 句、每句 12 字，黑体 / 宋体 / 等宽，单行 / 分行预览；旧单句迁移，随机变化及系统壁纸同步；视觉设置集中管理。
7. 数据恢复：备份包括视觉设置、歌词开关及循环模式，可选择恢复设置；重新关联音频保留歌曲身份、歌单、收藏、封面和歌词；设置失败不误删已恢复音频。

## 修改文件

- src/utils/use-music.js
- src/utils/system-controls.js
- src/utils/cover-particles.js
- src/utils/visual-settings.js（新增）
- src/utils/device-state.js（新增）
- src/components/ParticleCover.vue
- src/components/LyricsLines.vue
- src/components/TrackList.vue
- src/pages/index/index.vue
- src/uni_modules/wuyu-media-session/utssdk/app-android/WuyuDeviceState.kt（新增）
- src/uni_modules/wuyu-media-session/utssdk/app-android/WuyuWallpaperState.kt
- src/uni_modules/wuyu-media-session/utssdk/app-android/WuyuParticleWallpaperService.kt
- src/uni_modules/wuyu-media-session/utssdk/app-android/index.uts
- src/uni_modules/wuyu-media-session/utssdk/app-ios/index.uts（跨端空实现）
- src/uni_modules/wuyu-media-session/README.md
- tests/music-workflows.test.mjs（新增）
- package.json
- README.md
- LOCKSCREEN_INTEGRATION.md
- ANDROID_PLAYBACK_CHECKLIST.md

## 验证结果

- npm test：30 项通过。
- npm run build:h5：通过。
- npm run build:app：通过；此项生成 App 资源及 UTS 代码，不等于完整 APK 打包。
- 原生 Kotlin 联合编译：通过，兼容旧 API 的弃用警告仍存在。
- 浏览器 390 × 844 和 320 × 568：设置页未横向溢出，多选不误播放，文字保存重开可恢复，歌词手动滚动 / 恢复跟随正常，未发现浏览器运行错误。
- 预览图片：design/optimization/library-mobile.png、design/optimization/visual-settings-mobile.png。

## 尚需真机验证

adb 未连接设备。安卓设备上的流体云、锁屏播放、来电恢复、耳机控制、温控降级及真实耗电未验证。原生接口更新须重新打包自定义基座或完整 APK。

系统动态壁纸应用范围由设备系统提供。浏览器中的锁屏展示与系统壁纸入口仍分别标注。

Android 运行状态接口依据：https://developer.android.com/reference/android/os/PowerManager
