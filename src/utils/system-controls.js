// #ifdef APP-PLUS
import { onMediaAction, publishMedia, updateMediaPosition, getMediaStatus, releaseMedia } from '@/uni_modules/wuyu-media-session'
// #endif

export function createSystemControls(actions) {
  // #ifdef H5
  if ('mediaSession' in navigator) {
    for (const [action, callback] of Object.entries({ play: actions.play, pause: actions.pause, stop: actions.stop, previoustrack: actions.previous, nexttrack: actions.next, seekto: details => actions.seek(details.seekTime), seekbackward: details => actions.seek(Math.max(0, (actions.getTime?.() || 0) - (details.seekOffset || 10))), seekforward: details => actions.seek((actions.getTime?.() || 0) + (details.seekOffset || 10)) })) {
      try { navigator.mediaSession.setActionHandler(action, callback) } catch {}
    }
  }
  return {
    update(track, playing) {
      if (!('mediaSession' in navigator)) return
      if (!track) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; return }
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist || '未知歌手', album: track.album || '', artwork: track.cover ? [{ src: track.cover }] : [] })
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    },
    status() { return 'mediaSession' in navigator ? '浏览器媒体控制已接入；安卓系统功能请使用安装包' : '当前浏览器不支持系统媒体控制' },
    position(position, duration) {
      if (navigator.mediaSession?.setPositionState && duration > 0 && Number.isFinite(duration)) {
        try { navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: Math.max(0, Math.min(position, duration)) }) } catch {}
      }
    },
  }
  // #endif
  // #ifdef APP-PLUS
  if (plus.os.name !== 'Android') return { update() {} }
  const invoke = plus.android.invoke
  const activity = plus.android.runtimeMainActivity()
  const packageName = invoke(activity, 'getPackageName')
  const manager = invoke(activity, 'getSystemService', 'notification')
  const version = Number(plus.android.getAttribute('android.os.Build$VERSION', 'SDK_INT'))
  const channelId = 'wuyu_playback'
  const notificationId = 7341
  const actionPrefix = `${packageName}.WUYU_`
  const filter = plus.android.newObject('android.content.IntentFilter')
  for (const name of ['previous', 'toggle', 'next', 'pause']) invoke(filter, 'addAction', actionPrefix + name)
  invoke(filter, 'addAction', 'android.media.AUDIO_BECOMING_NOISY')
  let playing = false, lastTrack, requested = false, permissionGranted = version < 33
  const receiver = plus.android.implements('io.dcloud.feature.internal.reflect.BroadcastReceiver', {
    onReceive(context, intent) {
      const name = invoke(intent, 'getAction')
      if (name === 'android.media.AUDIO_BECOMING_NOISY') { if (playing) actions.interrupt?.('耳机或蓝牙音频已断开，播放已暂停'); return }
      if (name === actionPrefix + 'previous') actions.previous()
      if (name === actionPrefix + 'next') actions.next()
      if (name === actionPrefix + 'pause') actions.pause()
      if (name === actionPrefix + 'toggle') { if (playing) actions.pause(); else actions.play() }
    },
  })
  if (version >= 33) invoke(activity, 'registerReceiver', receiver, filter, 4)
  else invoke(activity, 'registerReceiver', receiver, filter)
  if (version >= 26) {
    const channel = plus.android.newObject('android.app.NotificationChannel', channelId, '雾屿音乐播放', 2)
    invoke(channel, 'setSound', null, null)
    invoke(manager, 'createNotificationChannel', channel)
  }
  let nativeSession = false, nativeFailed = false, nativeListening = false
  function listenNative() {
    if (nativeListening) return
    onMediaAction((action, seconds) => {
      if (action === 'play') actions.play()
      if (action === 'pause') actions.pause()
      if (action === 'stop') actions.stop()
      if (action === 'previous') actions.previous()
      if (action === 'next') actions.next()
      if (action === 'seek') actions.seek(seconds)
      if (action === 'favorite') actions.favorite?.()
      if (action === 'like') actions.favorite?.(true)
      if (action === 'unlike') actions.favorite?.(false)
    })
    nativeListening = true
  }
  function updateNative() {
    if (nativeFailed) return false
    try {
      listenNative()
      if (!lastTrack) { releaseMedia(); nativeSession = false; nativeListening = false; return true }
      let cover = lastTrack.cover || ''
      if (cover && !cover.startsWith('data:') && !cover.startsWith('content:')) cover = plus.io.convertLocalFileSystemURL(cover)
      const metadata = JSON.stringify({ id: lastTrack.id, audioKey: lastTrack.audioKey || lastTrack.id, title: lastTrack.title, artist: lastTrack.artist || '未知歌手', album: lastTrack.album || '', cover, favorite: !!lastTrack.favorite })
      nativeSession = publishMedia(metadata, playing, actions.getTime?.() || 0, actions.getDuration?.() || lastTrack.duration || 0)
      if (!nativeSession) throw new Error('Native media session unavailable')
      return true
    } catch (error) {
      nativeFailed = true; nativeSession = false
      try { releaseMedia() } catch {}
      console.warn('原生媒体会话不可用，已降级为播放通知', error)
      return false
    }
  }
  function pendingIntent(action, code) {
    const intent = plus.android.newObject('android.content.Intent', actionPrefix + action)
    invoke(intent, 'setPackage', packageName)
    return invoke('android.app.PendingIntent', 'getBroadcast', activity, code, intent, 134217728 | (version >= 23 ? 67108864 : 0))
  }
  function render() {
    if (!lastTrack || !permissionGranted) return
    const builder = version >= 26 ? plus.android.newObject('android.app.Notification$Builder', activity, channelId) : plus.android.newObject('android.app.Notification$Builder', activity)
    const icon = plus.android.getAttribute('android.R$drawable', 'ic_media_play')
    invoke(builder, 'setSmallIcon', icon)
    invoke(builder, 'setContentTitle', lastTrack.title)
    invoke(builder, 'setContentText', lastTrack.artist || '未知歌手')
    invoke(builder, 'setOnlyAlertOnce', true)
    invoke(builder, 'setShowWhen', false)
    invoke(builder, 'setOngoing', playing)
    invoke(builder, 'setDeleteIntent', pendingIntent('pause', 7345))
    invoke(builder, 'setCategory', 'transport')
    invoke(builder, 'setVisibility', 1)
    const launch = invoke(invoke(activity, 'getPackageManager'), 'getLaunchIntentForPackage', packageName)
    if (launch) invoke(builder, 'setContentIntent', invoke('android.app.PendingIntent', 'getActivity', activity, 7340, launch, 134217728 | (version >= 23 ? 67108864 : 0)))
    invoke(builder, 'addAction', plus.android.getAttribute('android.R$drawable', 'ic_media_previous'), '上一首', pendingIntent('previous', 7342))
    invoke(builder, 'addAction', plus.android.getAttribute('android.R$drawable', playing ? 'ic_media_pause' : 'ic_media_play'), playing ? '暂停' : '播放', pendingIntent('toggle', 7343))
    invoke(builder, 'addAction', plus.android.getAttribute('android.R$drawable', 'ic_media_next'), '下一首', pendingIntent('next', 7344))
    const style = plus.android.newObject('android.app.Notification$MediaStyle')
    invoke(style, 'setShowActionsInCompactView', [0, 1, 2])
    invoke(builder, 'setStyle', style)
    invoke(manager, 'notify', notificationId, invoke(builder, 'build'))
  }
  return {
    update(track, isPlaying) {
      playing = isPlaying; lastTrack = track
      if (version >= 33) permissionGranted = Number(invoke(activity, 'checkSelfPermission', 'android.permission.POST_NOTIFICATIONS')) === 0
      if (version >= 33 && !requested && !permissionGranted && playing) {
        requested = true
        plus.android.requestPermissions(['android.permission.POST_NOTIFICATIONS'], result => {
          permissionGranted = result.granted.includes('android.permission.POST_NOTIFICATIONS')
          if (permissionGranted) { if (!updateNative()) render() }
        }, error => console.warn('通知权限请求失败', error))
      }
      if (updateNative()) return
      if (!track) { invoke(manager, 'cancel', notificationId); return }
      render()
    },
    position(position, duration) {
      if (!nativeSession || nativeFailed) return
      try { updateMediaPosition(position, duration) } catch (error) { console.warn('系统媒体进度同步失败', error) }
    },
    status() {
      if (nativeFailed) return '普通播放通知 · 原生媒体模块未能启动，请重新打包基座'
      try {
        const state = JSON.parse(getMediaStatus())
        if (state.error) return '媒体会话启动失败：' + state.error
        if (state.sessionActive) return '系统媒体会话已启动 · 流体云展示由 ColorOS 决定'
        return '等待播放歌曲后启动系统媒体会话'
      } catch { return '原生媒体模块尚未就绪' }
    },
  }
  // #endif
}

