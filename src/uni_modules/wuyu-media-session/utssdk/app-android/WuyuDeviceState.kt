package com.wuyu.media

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import org.json.JSONObject

object WuyuDeviceState {
    @JvmStatic fun status(context: Context): String {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return JSONObject().put("available", true).put("brand", Build.BRAND).put("model", Build.MODEL)
            .put("android", Build.VERSION.RELEASE).put("powerSave", power.isPowerSaveMode)
            .put("thermal", try { if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else -1 } catch (_: Exception) { -1 })
            .put("batteryExempt", if (Build.VERSION.SDK_INT >= 23) power.isIgnoringBatteryOptimizations(context.packageName) else true)
            .put("notifications", if (Build.VERSION.SDK_INT >= 24) notifications.areNotificationsEnabled() else true)
            .put("media", JSONObject(WuyuMediaBridge.status())).toString()
    }

    @JvmStatic fun open(activity: Activity, kind: String): String = try {
        val intent = when {
            kind == "notifications" && Build.VERSION.SDK_INT >= 26 -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            kind == "battery" && Build.VERSION.SDK_INT >= 23 -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
        }
        activity.startActivity(intent)
        ""
    } catch (_: Exception) { "系统未提供此设置入口，请手动打开应用设置" }
}
