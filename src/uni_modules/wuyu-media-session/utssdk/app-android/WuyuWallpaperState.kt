package com.wuyu.media

import android.app.Activity
import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AtomicFile
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

internal data class WallpaperEnvelope(val key: String, val rate: Int, val duration: Double, val energy: FloatArray, val bass: FloatArray)
internal data class WallpaperSnapshot(
    val key: String = "", val playing: Boolean = false, val position: Double = 0.0,
    val duration: Double = 0.0, val at: Long = SystemClock.elapsedRealtime(),
    val colors: IntArray = IntArray(0), val envelope: WallpaperEnvelope? = null,
    val intensity: Float = .8f, val texts: List<String> = emptyList(), val textFont: String = "sans", val textLayout: String = "stack"
)

object WuyuWallpaperState {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val observers = CopyOnWriteArraySet<() -> Unit>()
    @Volatile internal var snapshot = WallpaperSnapshot()
        private set
    private var context: Context? = null
    private var restored = false
    private var receivedPlayback = false
    private var receivedOptions = false
    private var receivedText = false
    private var pendingEnvelope: WallpaperEnvelope? = null
    private var lastSaveAt = 0L

    @Synchronized internal fun attach(value: Context) {
        context = value.applicationContext
        if (restored) return
        restored = true
        io.execute {
            val saved = try {
                DataInputStream(AtomicFile(File(value.filesDir, "wuyu-wallpaper.bin")).openRead()).use { input ->
                    val version = input.readInt(); require(version in 2..3)
                    val key = input.readUTF()
                    val intensity = input.readFloat().coerceIn(0f, 1f)
                    val textSettings = if (version >= 3) JSONObject(input.readUTF()) else JSONObject()
                    val texts = parseTexts(textSettings)
                    val length = input.readInt(); require(length == 0 || length == 58 * 58)
                    val colors = IntArray(length) { input.readInt() }
                    val envelope = if (input.readBoolean()) {
                        val rate = input.readInt(); val duration = input.readDouble(); val count = input.readInt()
                        require(rate == 40 && count in 1..120000 && duration.isFinite() && duration > 0)
                        val values = FloatArray(count) { input.readFloat().also { require(it.isFinite() && it in 0f..1f) } }
                        val bass = FloatArray(count) { input.readFloat().also { require(it.isFinite() && it in 0f..1f) } }
                        WallpaperEnvelope(key, rate, duration, values, bass)
                    } else null
                    WallpaperSnapshot(key = key, colors = colors, envelope = envelope, intensity = intensity, texts = texts, textFont = textSettings.optString("textFont", "sans"), textLayout = textSettings.optString("textLayout", "stack"))
                }
            } catch (_: Exception) { null }
            main.post {
                synchronized(this) {
                    if (saved != null && (!receivedPlayback || snapshot.key == saved.key)) {
                        snapshot = if (!receivedPlayback) saved.copy(intensity = if (receivedOptions) snapshot.intensity else saved.intensity,
                            texts = if (receivedText) snapshot.texts else saved.texts, textFont = if (receivedText) snapshot.textFont else saved.textFont,
                            textLayout = if (receivedText) snapshot.textLayout else saved.textLayout)
                            else snapshot.copy(colors = if (snapshot.colors.isEmpty()) saved.colors else snapshot.colors,
                                envelope = snapshot.envelope ?: saved.envelope,
                                texts = if (receivedText) snapshot.texts else saved.texts, textFont = if (receivedText) snapshot.textFont else saved.textFont,
                                textLayout = if (receivedText) snapshot.textLayout else saved.textLayout)
                        changed()
                    }
                }
            }
        }
    }
    @Synchronized internal fun playback(value: Context, key: String, playing: Boolean, position: Double, duration: Double) {
        attach(value); receivedPlayback = true
        val previous = snapshot
        val same = previous.key == key
        snapshot = previous.copy(key = key, playing = playing, position = position, duration = duration,
            at = SystemClock.elapsedRealtime(), colors = if (same) previous.colors else IntArray(0),
            envelope = previous.envelope?.takeIf { it.key == key } ?: pendingEnvelope?.takeIf { it.key == key })
        changed()
    }
    @Synchronized internal fun position(position: Double, duration: Double) {
        snapshot = snapshot.copy(position = position, duration = duration, at = SystemClock.elapsedRealtime())
        // Active engines already have a frame loop. A paused seek needs one redraw.
        if (!snapshot.playing) changed()
    }
    @Synchronized internal fun artwork(key: String, bitmap: Bitmap?) {
        if (snapshot.key != key) return
        val colors = IntArray(58 * 58)
        if (bitmap != null) {
            val side = minOf(bitmap.width, bitmap.height)
            val square = Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side)
            val sample = Bitmap.createScaledBitmap(square, 58, 58, true)
            sample.getPixels(colors, 0, 58, 0, 0, 58, 58)
            if (sample !== bitmap && sample !== square) sample.recycle()
            if (square !== bitmap) square.recycle()
        }
        snapshot = snapshot.copy(colors = colors)
        save(); changed()
    }
    @JvmStatic @Synchronized fun options(value: Context, intensity: Double) {
        attach(value); receivedOptions = true
        snapshot = snapshot.copy(intensity = intensity.toFloat().coerceIn(0f, 1f))
        save(); changed()
    }
    private fun parseTexts(data: JSONObject): List<String> {
        val array = data.optJSONArray("customTexts") ?: return emptyList()
        return (0 until minOf(array.length(), 8)).mapNotNull { index ->
            val text = array.optString(index).trim()
            if (text.isEmpty()) null else text.substring(0, text.offsetByCodePoints(0, minOf(12, text.codePointCount(0, text.length))))
        }.distinct()
    }
    @JvmStatic @Synchronized fun textOptions(value: Context, json: String) {
        if (json.length > 4096) return
        try {
            val data = JSONObject(json)
            attach(value); receivedText = true
            snapshot = snapshot.copy(texts = parseTexts(data),
                textFont = data.optString("textFont").takeIf { it in listOf("sans", "serif", "mono") } ?: "sans",
                textLayout = data.optString("textLayout").takeIf { it in listOf("stack", "line") } ?: "stack")
            save(); changed()
        } catch (_: Exception) {}
    }
    @JvmStatic fun envelope(value: Context, json: String): Boolean {
        if (json.length > 3500000) return false
        attach(value)
        io.execute {
            try {
                val data = JSONObject(json)
                val key = data.getString("key"); val rate = data.getInt("rate")
                val duration = data.getDouble("duration")
                val energy = data.getJSONArray("values"); val bass = data.getJSONArray("low")
                require(rate == 40 && duration.isFinite() && duration > 0 && energy.length() == kotlin.math.ceil(duration * rate).toInt())
                require(energy.length() in 1..120000 && energy.length() == bass.length())
                fun values(array: org.json.JSONArray) = FloatArray(array.length()) { index ->
                    val number = array.getDouble(index); require(number.isFinite() && number in 0.0..1.0); number.toFloat()
                }
                val envelope = WallpaperEnvelope(key, rate, duration, values(energy), values(bass))
                main.post { synchronized(this) {
                    pendingEnvelope = envelope
                    if (snapshot.key == key) { snapshot = snapshot.copy(envelope = envelope); save(); changed() }
                } }
            } catch (_: Exception) { /* Invalid or obsolete analysis never interrupts playback. */ }
        }
        return true
    }
    @Synchronized internal fun stopped() { snapshot = snapshot.copy(playing = false); changed() }
    internal fun observe(callback: () -> Unit) { observers.add(callback) }
    internal fun remove(callback: () -> Unit) { observers.remove(callback) }
    private fun changed() { main.post { observers.forEach { it() } } }
    private fun save() {
        val ctx = context ?: return
        val state = snapshot
        // Persist visual assets, never a fictitious playing state or audio data.
        if (state.colors.isNotEmpty() && state.colors.size != 58 * 58) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastSaveAt < 500) {
            main.removeCallbacks(saveLater); main.postDelayed(saveLater, 550); return
        }
        lastSaveAt = now
        io.execute {
            val file = AtomicFile(File(ctx.filesDir, "wuyu-wallpaper.bin"))
            var stream: java.io.FileOutputStream? = null
            try {
                stream = file.startWrite()
                val output = DataOutputStream(stream)
                output.writeInt(3); output.writeUTF(state.key); output.writeFloat(state.intensity)
                output.writeUTF(JSONObject().put("customTexts", org.json.JSONArray(state.texts)).put("textFont", state.textFont).put("textLayout", state.textLayout).toString())
                output.writeInt(state.colors.size); state.colors.forEach { output.writeInt(it) }
                val envelope = state.envelope?.takeIf { it.key == state.key }
                output.writeBoolean(envelope != null)
                if (envelope != null) {
                    output.writeInt(envelope.rate); output.writeDouble(envelope.duration); output.writeInt(envelope.energy.size)
                    envelope.energy.forEach { output.writeFloat(it) }; envelope.bass.forEach { output.writeFloat(it) }
                }
                output.flush()
                file.finishWrite(stream)
            } catch (_: Exception) { stream?.let { file.failWrite(it) } }
        }
    }
    private val saveLater = Runnable { synchronized(this) { save() } }

    @JvmStatic fun openPreview(activity: Activity): String {
        attach(activity)
        return try {
            val manager = WallpaperManager.getInstance(activity)
            if (!manager.isWallpaperSupported) return "此设备不支持应用动态壁纸"
            if (android.os.Build.VERSION.SDK_INT >= 24 && !manager.isSetWallpaperAllowed) return "系统策略不允许更换壁纸"
            val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
                .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, ComponentName(activity, WuyuParticleWallpaperService::class.java))
            activity.startActivity(intent)
            ""
        } catch (_: Exception) { "无法打开系统壁纸预览，请重新打包包含动态壁纸服务的 APK" }
    }
}
