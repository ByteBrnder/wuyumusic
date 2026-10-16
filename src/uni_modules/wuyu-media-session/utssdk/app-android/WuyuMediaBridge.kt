package com.wuyu.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.Rating
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.util.concurrent.Executors

object WuyuMediaBridge {
    private val main = Handler(Looper.getMainLooper())
    private var listener: ((String, Double) -> Unit)? = null
    internal var service: WuyuMediaService? = null
    internal var metadata = JSONObject()
    internal var playing = false
    internal var positionMs = 0L
    internal var durationMs = 0L
    private var starting = false
    private var error = ""

    @JvmStatic fun listen(callback: (String, Double) -> Unit) { listener = callback }
    internal fun emit(action: String, seconds: Double = 0.0) {
        main.post { listener?.invoke(action, seconds) }
    }
    internal fun failure(message: String) { error = message }
    @JvmStatic fun publish(context: Context, json: String, active: Boolean, position: Double, duration: Double): Boolean {
        return try {
            val next = JSONObject(json)
            if (metadata.optString("id") != next.optString("id")) positionMs = 0
            metadata = next; playing = active
            positionMs = (position.coerceAtLeast(0.0) * 1000).toLong()
            durationMs = (duration.coerceAtLeast(0.0) * 1000).toLong()
            WuyuWallpaperState.playback(context, next.optString("audioKey", next.optString("id")), active, position, duration)
            val current = service
            if (current != null) main.post { current.refresh() }
            else if (active && !starting) {
                starting = true
                val intent = Intent(context, WuyuMediaService::class.java)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            }
            error = ""
            true
        } catch (exception: Exception) {
            starting = false; error = exception.javaClass.simpleName
            false
        }
    }
    internal fun attached(value: WuyuMediaService) { service = value; starting = false }
    internal fun detached(value: WuyuMediaService) { if (service === value) service = null; starting = false }
    @JvmStatic fun position(position: Double, duration: Double) {
        val changedDuration = durationMs != (duration * 1000).toLong()
        positionMs = (position.coerceAtLeast(0.0) * 1000).toLong()
        durationMs = (duration.coerceAtLeast(0.0) * 1000).toLong()
        WuyuWallpaperState.position(position, duration)
        main.post { if (changedDuration) service?.refresh() else service?.publishPosition() }
    }
    @JvmStatic fun status(): String = JSONObject().put("available", true)
        .put("sessionActive", service != null).put("starting", starting).put("error", error)
        .put("brand", Build.BRAND).put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT).toString()
    @JvmStatic fun release() {
        playing = false
        WuyuWallpaperState.stopped()
        main.post { service?.stopSelf() }
        metadata = JSONObject(); listener = null
    }
}

class WuyuMediaService : Service() {
    private lateinit var session: MediaSession
    private val artworkWorker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var artwork: Bitmap? = null
    private var coverKey = ""
    private var artRevision = 0
    private var metadataKey = ""
    private var foreground = false
    private var destroyed = false
    private var lastPositionAt = 0L
    private var lastPositionMs = -1L

    override fun onCreate() {
        super.onCreate()
        WuyuMediaBridge.attached(this)
        session = MediaSession(this, "WuyuMusic")
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
        if (Build.VERSION.SDK_INT >= 22) session.setRatingType(Rating.RATING_HEART)
        session.setCallback(object : MediaSession.Callback() {
            override fun onPlay() { WuyuMediaBridge.emit("play") }
            override fun onPause() { WuyuMediaBridge.emit("pause") }
            override fun onStop() { WuyuMediaBridge.emit("stop"); stopSelf() }
            override fun onSkipToPrevious() { WuyuMediaBridge.emit("previous") }
            override fun onSkipToNext() { WuyuMediaBridge.emit("next") }
            override fun onSeekTo(pos: Long) { WuyuMediaBridge.emit("seek", pos.coerceAtLeast(0).toDouble() / 1000) }
            override fun onSetRating(rating: Rating) {
                if (rating.ratingStyle == Rating.RATING_HEART) WuyuMediaBridge.emit(if (rating.hasHeart()) "like" else "unlike")
            }
            override fun onCustomAction(action: String, extras: Bundle?) {
                if (action == "favorite") WuyuMediaBridge.emit("favorite")
            }
        }, main)
        session.setSessionActivity(openPlayer())
        session.isActive = true
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL, "雾屿音乐播放", NotificationManager.IMPORTANCE_LOW)
            channel.setSound(null, null); channel.setShowBadge(false)
            notifications().createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") {
            WuyuMediaBridge.emit("stop"); stopSelf(); return START_NOT_STICKY
        }
        when (intent?.action) {
            "previous", "next", "pause", "favorite" -> WuyuMediaBridge.emit(intent.action!!)
            "toggle" -> WuyuMediaBridge.emit(if (WuyuMediaBridge.playing) "pause" else "play")
        }
        refresh()
        return START_NOT_STICKY
    }
    override fun onBind(intent: Intent?): IBinder? = null

    internal fun refresh() {
        if (destroyed) return
        val track = WuyuMediaBridge.metadata
        if (track.optString("id").isEmpty()) { stopSelf(); return }
        if (track.optString("cover") != coverKey) artwork = null
        val key = track.toString() + WuyuMediaBridge.durationMs
        if (key != metadataKey) { metadataKey = key; publishMetadata() }
        publishPosition(true)
        val cover = track.optString("cover")
        if (cover != coverKey) {
            coverKey = cover; artwork = null; publishMetadata()
            val particleKey = track.optString("audioKey", track.optString("id"))
            WuyuWallpaperState.artwork(particleKey, null)
            val revision = ++artRevision
            if (cover.isNotEmpty()) artworkWorker.execute {
                val bitmap = readArtwork(cover)
                main.post {
                    if (destroyed || revision != artRevision) { bitmap?.recycle(); return@post }
                    artwork = bitmap; publishMetadata(); publishNotification()
                    WuyuWallpaperState.artwork(particleKey, bitmap)
                }
            }
        }
        publishNotification()
    }
    private fun publishMetadata() {
        val track = WuyuMediaBridge.metadata
        val builder = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, track.optString("id"))
            .putString(MediaMetadata.METADATA_KEY_TITLE, track.optString("title"))
            .putString(MediaMetadata.METADATA_KEY_ARTIST, track.optString("artist", "未知歌手"))
            .putString(MediaMetadata.METADATA_KEY_ALBUM, track.optString("album"))
            .putLong(MediaMetadata.METADATA_KEY_DURATION, WuyuMediaBridge.durationMs)
            .putRating(MediaMetadata.METADATA_KEY_USER_RATING, Rating.newHeartRating(track.optBoolean("favorite")))
        artwork?.let {
            builder.putBitmap(MediaMetadata.METADATA_KEY_ART, it)
            builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
        }
        session.setMetadata(builder.build())
    }
    internal fun publishPosition(force: Boolean = false) {
        if (destroyed) return
        val now = SystemClock.elapsedRealtime()
        val position = WuyuMediaBridge.positionMs
        // The system extrapolates between updates; seeks bypass the throttle.
        if (!force && now - lastPositionAt < 900 && kotlin.math.abs(position - lastPositionMs) < 1400) return
        lastPositionAt = now; lastPositionMs = position
        val state = PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE
            or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or PlaybackState.ACTION_SKIP_TO_PREVIOUS
            or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_SET_RATING)
            .setState(if (WuyuMediaBridge.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                position.coerceIn(0, WuyuMediaBridge.durationMs.coerceAtLeast(position)), if (WuyuMediaBridge.playing) 1f else 0f, now)
            .addCustomAction("favorite", if (WuyuMediaBridge.metadata.optBoolean("favorite")) "取消喜欢" else "喜欢",
                android.R.drawable.btn_star_big_off)
        session.setPlaybackState(state.build())
    }
    private fun notifications() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private fun openPlayer(): PendingIntent? {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(this, 7340, intent, pendingFlags())
    }
    private fun pendingFlags() = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
    private fun action(name: String, code: Int) = PendingIntent.getService(this, code,
        Intent(this, WuyuMediaService::class.java).setAction(name), pendingFlags())
    private fun publishNotification() {
        if (destroyed) return
        val track = WuyuMediaBridge.metadata
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(track.optString("title"))
            .setContentText(track.optString("artist", "未知歌手")).setContentIntent(openPlayer())
            .setOnlyAlertOnce(true).setShowWhen(false).setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(WuyuMediaBridge.playing)
            .setDeleteIntent(action("stop", 7345))
            .addAction(android.R.drawable.ic_media_previous, "上一首", action("previous", 7342))
            .addAction(if (WuyuMediaBridge.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (WuyuMediaBridge.playing) "暂停" else "播放", action("toggle", 7343))
            .addAction(android.R.drawable.ic_media_next, "下一首", action("next", 7344))
            .addAction(android.R.drawable.btn_star_big_off, "喜欢", action("favorite", 7346))
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
        artwork?.let { builder.setLargeIcon(it) }
        val notification = builder.build()
        try {
            if (!foreground) { startForeground(NOTIFICATION, notification); foreground = true }
            else notifications().notify(NOTIFICATION, notification)
        } catch (exception: Exception) { WuyuMediaBridge.failure(exception.javaClass.simpleName); stopSelf() }
    }
    private fun readArtwork(source: String): Bitmap? = try {
        val bytes = if (source.startsWith("data:image/") && source.length <= 8 * 1024 * 1024)
            Base64.decode(source.substringAfter(','), Base64.DEFAULT) else null
        fun open(): InputStream? = when {
            bytes != null -> ByteArrayInputStream(bytes)
            source.startsWith("content://") -> contentResolver.openInputStream(Uri.parse(source))
            source.startsWith("file://") -> File(Uri.parse(source).path ?: "").inputStream()
            source.startsWith("/") -> File(source).inputStream()
            else -> null
        }
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open()?.use { BitmapFactory.decodeStream(it, null, options) }
        if (options.outWidth <= 0 || options.outHeight <= 0) null else {
            var sample = 1
            while (maxOf(options.outWidth, options.outHeight) / sample > 512) sample *= 2
            options.inJustDecodeBounds = false; options.inSampleSize = sample
            open()?.use { BitmapFactory.decodeStream(it, null, options) }
        }
    } catch (_: Exception) { null }

    override fun onDestroy() {
        destroyed = true; ++artRevision
        artworkWorker.shutdownNow(); main.removeCallbacksAndMessages(null)
        session.isActive = false; session.setCallback(null); session.release()
        stopForeground(true); notifications().cancel(NOTIFICATION)
        WuyuMediaBridge.detached(this)
        WuyuWallpaperState.stopped()
        super.onDestroy()
    }
    companion object { private const val CHANNEL = "wuyu_playback"; private const val NOTIFICATION = 7341 }
}
