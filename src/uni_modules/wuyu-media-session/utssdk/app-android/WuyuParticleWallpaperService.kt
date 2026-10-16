package com.wuyu.media

import android.app.KeyguardManager
import android.app.WallpaperColors
import android.app.WallpaperManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.service.wallpaper.WallpaperService
import android.view.MotionEvent
import android.view.SurfaceHolder
import kotlin.math.*

class WuyuParticleWallpaperService : WallpaperService() {
    override fun onCreateEngine(): Engine = ParticleEngine()

    inner class ParticleEngine : Engine() {
        private val handler = Handler(Looper.getMainLooper())
        private val power by lazy { getSystemService(Context.POWER_SERVICE) as PowerManager }
        private val keyguard by lazy { getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager }
        private val renderer = LockParticleRenderer()
        private var surfaceReady = false
        private var disposed = false
        private var lastFrame = 0L
        private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null
        private val onChange: () -> Unit = { schedule() }
        private val frame = Runnable { drawFrame() }
        private val screen = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) { schedule() }
        }
        override fun onCreate(holder: SurfaceHolder) {
            super.onCreate(holder)
            WuyuWallpaperState.attach(this@WuyuParticleWallpaperService)
            WuyuWallpaperState.observe(onChange)
            if (Build.VERSION.SDK_INT >= 29) {
                try { thermalListener = PowerManager.OnThermalStatusChangedListener { schedule() }; power.addThermalStatusListener(thermalListener!!) } catch (_: Exception) {}
            }
            setTouchEventsEnabled(true)
            setOffsetNotificationsEnabled(false)
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_USER_PRESENT)
                addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
            }
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED)
            else registerReceiver(screen, filter)
        }
        private fun canDraw() = !disposed && surfaceReady && isVisible && power.isInteractive
        private fun reducedMotion(): Boolean = try {
            Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        } catch (_: Exception) { false }
        private fun lockTarget(): Boolean {
            if (isPreview) return true
            if (Build.VERSION.SDK_INT >= 34) return wallpaperFlags and WallpaperManager.FLAG_LOCK != 0 && keyguard.isKeyguardLocked
            return keyguard.isKeyguardLocked
        }
        private fun schedule() {
            handler.removeCallbacks(frame)
            lastFrame = 0
            if (canDraw()) handler.post(frame)
        }
        private fun drawFrame() {
            if (!canDraw()) return
            val now = SystemClock.elapsedRealtime()
            val delta = if (lastFrame == 0L) 1f / 24 else ((now - lastFrame) / 1000f).coerceIn(0f, .08f)
            lastFrame = now
            val state = WuyuWallpaperState.snapshot
            val reduced = reducedMotion()
            val thermal = try { if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else 0 } catch (_: Exception) { 0 }
            val saving = power.isPowerSaveMode || thermal >= PowerManager.THERMAL_STATUS_MODERATE
            val animate = state.playing && lockTarget() && !reduced && thermal < PowerManager.THERMAL_STATUS_SEVERE
            var canvas: Canvas? = null
            try {
                if (!surfaceHolder.surface.isValid) return
                canvas = surfaceHolder.lockCanvas()
                if (canvas != null) renderer.draw(canvas, state, delta, animate, reduced, saving)
            } catch (_: Exception) {
                // Surface can disappear between the visibility callback and lockCanvas.
            } finally { canvas?.let { try { surfaceHolder.unlockCanvasAndPost(it) } catch (_: Exception) {} } }
            if (canDraw() && (animate || renderer.settling)) handler.postDelayed(frame, if (saving) 67 else 42)
        }
        override fun onVisibilityChanged(visible: Boolean) { super.onVisibilityChanged(visible); schedule() }
        override fun onWallpaperFlagsChanged(which: Int) { schedule() }
        override fun onSurfaceCreated(holder: SurfaceHolder) { super.onSurfaceCreated(holder); surfaceReady = true; schedule() }
        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) { super.onSurfaceChanged(holder, format, width, height); schedule() }
        override fun onSurfaceDestroyed(holder: SurfaceHolder) { surfaceReady = false; handler.removeCallbacks(frame); super.onSurfaceDestroyed(holder) }
        override fun onTouchEvent(event: MotionEvent) {
            if (isPreview || lockTarget()) { renderer.touch(event); schedule() }
            super.onTouchEvent(event)
        }
        override fun onComputeColors(): WallpaperColors? {
            if (Build.VERSION.SDK_INT < 27) return null
            val sample = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
            sample.eraseColor(Color.rgb(239, 246, 241))
            val result = WallpaperColors.fromBitmap(sample)
            sample.recycle()
            return result
        }
        override fun onDestroy() {
            disposed = true; handler.removeCallbacksAndMessages(null)
            WuyuWallpaperState.remove(onChange)
            try { unregisterReceiver(screen) } catch (_: Exception) {}
            if (Build.VERSION.SDK_INT >= 29) thermalListener?.let { try { power.removeThermalStatusListener(it) } catch (_: Exception) {} }
            renderer.destroy(); super.onDestroy()
        }
    }
}

private class LockParticleRenderer {
    private class Dot { var x = 0f; var y = 0f; var depth = 0f; var radius = 1f; var color = 0 }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val background = Paint()
    private var height = 0
    private var width = 0
    private var phase = 0f
    private var breathPhase = 0f
    private var gain = 0f
    private var energy = 0f
    private var bass = 0f
    private var baseline = 0f
    private var beat = 0f
    private var yaw = 0f
    private var pitch = 0f
    private var touchX = 0f
    private var touchY = 0f
    private var dragging = false
    private var track = ""
    private var currentShape = 0
    private var nextShape = 0
    private var morph = 1f
    private var shapeTime = 0f
    private var colors = IntArray(0)
    private var textPoints = sampleText("雾屿音乐", "sans", "stack")
    private var textSignature = ""
    private var textIndex = 0
    private val dots = MutableList(1400) { Dot() }
    private val shapeA = FloatArray(3)
    private val shapeB = FloatArray(3)
    val settling get() = gain > .005f || morph < 1f

    fun touch(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { dragging = true; touchX = event.x; touchY = event.y }
            MotionEvent.ACTION_MOVE -> if (dragging && event.pointerCount == 1) {
                yaw += (event.x - touchX) * .006f
                pitch = (pitch + (event.y - touchY) * .006f).coerceIn(-.9f, .9f)
                touchX = event.x; touchY = event.y
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragging = false
        }
    }
    private fun sampleText(text: String, font: String, layout: String): List<Pair<Float, Float>> {
        val characters = ArrayList<String>()
        var offset = 0
        while (offset < text.length && characters.size < 12) {
            val end = offset + Character.charCount(text.codePointAt(offset))
            characters.add(text.substring(offset, end)); offset = end
        }
        val lines = characters.chunked(if (layout == "line") 12 else 4).map { it.joinToString("") }
        val bitmap = Bitmap.createBitmap(640, maxOf(180, lines.size * 156 + 24), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textSize = if (layout == "line") minOf(128f, 600f / maxOf(1, characters.size)) else 128f
            textAlign = Paint.Align.CENTER
            typeface = android.graphics.Typeface.create(when (font) { "serif" -> "serif"; "mono" -> "monospace"; else -> "sans-serif" }, android.graphics.Typeface.BOLD)
        }
        val extent = maxOf(lines.maxOfOrNull { pen.measureText(it) } ?: 128f, (bitmap.height - 24).toFloat(), 128f)
        lines.forEachIndexed { index, line -> canvas.drawText(line, 320f, 12 + index * 156f + 78 - (pen.ascent() + pen.descent()) / 2, pen) }
        val points = ArrayList<Pair<Float, Float>>()
        for (y in 0 until bitmap.height step 2) for (x in 0 until bitmap.width step 2) {
            if (Color.alpha(bitmap.getPixel(x, y)) > 110) points.add(Pair((x - 320) / extent * 2, (y - bitmap.height / 2) / extent * 2))
        }
        bitmap.recycle()
        return points.ifEmpty { listOf(Pair(0f, 0f)) }
    }
    private fun shape(type: Int, index: Int, count: Int, out: FloatArray) {
        val u = (index + .5f) / count
        val angle = index * 2.3999632f
        when (type) {
            1 -> {
                val y = 1 - u * 2; val radius = sqrt(1 - y * y)
                out[0] = cos(angle) * radius; out[1] = y; out[2] = sin(angle) * radius
            }
            2 -> {
                val point = textPoints[(index * 7919 % textPoints.size)]
                out[0] = point.first; out[1] = point.second; out[2] = sin(angle) * .025f
            }
            3 -> {
                val a = (index % 58) / 58f * PI.toFloat() * 2
                val b = (index / 58) / 58f * PI.toFloat() * 2
                out[0] = (.72f + .26f * cos(b)) * cos(a)
                out[1] = .26f * sin(b); out[2] = (.72f + .26f * cos(b)) * sin(a)
            }
            else -> { out[0] = (index % 58 / 57f - .5f) * 1.8f; out[1] = (index / 58 / 57f - .5f) * 1.8f; out[2] = 0f }
        }
    }
    fun draw(canvas: Canvas, state: WallpaperSnapshot, delta: Float, animate: Boolean, reduced: Boolean, saving: Boolean) {
        if (width != canvas.width || height != canvas.height) {
            width = canvas.width; height = canvas.height
            background.shader = LinearGradient(0f, 0f, width.toFloat(), height.toFloat(),
                Color.rgb(247, 250, 247), Color.rgb(224, 237, 229), Shader.TileMode.CLAMP)
        }
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), background)
        if (track != state.key) {
            track = state.key; currentShape = 0; nextShape = 0; morph = 1f; shapeTime = 0f
            energy = 0f; bass = 0f; baseline = 0f; beat = 0f
        }
        val texts = (listOf("雾屿音乐") + state.texts).distinct()
        val signature = texts.joinToString("\n") + state.textFont + state.textLayout
        if (signature != textSignature) {
            textSignature = signature; textIndex = 0
            textPoints = sampleText(texts[0], state.textFont, state.textLayout)
        }
        colors = state.colors
        gain = if (reduced) 0f else gain + ((if (animate) 1f else 0f) - gain) * (1 - exp(-delta * 5))
        var target = 0f; var lowTarget = 0f
        val envelope = state.envelope
        val time = state.position + if (state.playing) (SystemClock.elapsedRealtime() - state.at) / 1000.0 else 0.0
        if (animate && envelope != null && envelope.key == state.key && time < envelope.duration) {
            val position = (time * envelope.rate).coerceAtLeast(0.0)
            val index = position.toInt(); val blend = (position - index).toFloat()
            if (index in envelope.energy.indices) {
                target = envelope.energy[index] * (1 - blend) + envelope.energy[minOf(index + 1, envelope.energy.lastIndex)] * blend
                lowTarget = envelope.bass[index] * (1 - blend) + envelope.bass[minOf(index + 1, envelope.bass.lastIndex)] * blend
            }
        }
        energy += (target - energy) * (1 - exp(-delta * 10))
        bass += (lowTarget - bass) * (1 - exp(-delta * 12))
        baseline += (bass - baseline) * (1 - exp(-delta * 1.4f))
        beat += ((maxOf(0f, bass - baseline) * 3).coerceAtMost(1f) - beat) * (1 - exp(-delta * 8))
        if (animate) {
            phase += delta * (.25f + energy)
            breathPhase += delta * PI.toFloat() * 2 / 4.8f
            shapeTime += delta
            if (shapeTime >= 24 && !dragging) { shapeTime = 0f; currentShape = nextShape; nextShape = (nextShape + (1..3).random()) % 4; morph = 0f
                if (nextShape == 2) { textIndex = (textIndex + 1) % texts.size; textPoints = sampleText(texts[textIndex], state.textFont, state.textLayout) } }
        }
        morph = if (reduced) 1f else minOf(1f, morph + delta / 3)
        val blend = morph * morph * (3 - 2 * morph)
        val breath = .5f - .5f * cos(breathPhase)
        val pulse = 1 + gain * state.intensity * (.07f * breath + .11f * bass + .08f * beat)
        val size = minOf(width * .68f, height * .38f)
        val cy = cos(yaw); val sy = sin(yaw); val cx = cos(pitch); val sx = sin(pitch)
        val count = if (saving) 850 else 1400
        val activeDots = dots.subList(0, count)
        for (i in 0 until count) {
            val source = i * 58 * 58 / count
            shape(currentShape, source, 58 * 58, shapeA); shape(nextShape, source, 58 * 58, shapeB)
            var x = (shapeA[0] + (shapeB[0] - shapeA[0]) * blend) * pulse
            var y = (shapeA[1] + (shapeB[1] - shapeA[1]) * blend) * pulse
            val z = (shapeA[2] + (shapeB[2] - shapeA[2]) * blend) * pulse
            x += sin(phase + source * .17f) * gain * .008f
            y += cos(phase + source * .13f) * gain * .008f
            val rx = x * cy + z * sy; val rz = -x * sy + z * cy
            val ry = y * cx - rz * sx; val depth = y * sx + rz * cx
            val perspective = 3.5f / (3.5f + depth)
            val dot = activeDots[i]
            dot.x = width * .5f + rx * size * .46f * perspective
            dot.y = height * .49f + ry * size * .46f * perspective
            dot.depth = depth; dot.radius = maxOf(.8f, size / 125f * perspective * (.72f + breath * gain * .12f))
            val color = if (source in colors.indices && Color.alpha(colors[source]) > 30) colors[source] else Color.rgb(95, 145, 117)
            dot.color = if (nextShape == 2) Color.rgb((Color.red(color) * .65f).toInt(), (Color.green(color) * .7f).toInt(), (Color.blue(color) * .65f).toInt()) else color
        }
        activeDots.sortByDescending { it.depth }
        for (dot in activeDots) {
            paint.color = dot.color; paint.alpha = ((.87f - dot.depth * .2f).coerceIn(.4f, .98f) * 255).toInt()
            canvas.drawCircle(dot.x, dot.y, dot.radius, paint)
        }
    }
    fun destroy() { dragging = false; colors = IntArray(0) }
}
