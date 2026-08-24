package top.nexmusic.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class MediaUpdateArgs {
    var title: String = ""
    var artist: String = ""
    var cover: String = ""
    var playing: Boolean = false
    var durationMs: Long = 0
    var positionMs: Long = 0
}

object MediaPlaybackHolder {
    @Volatile
    var plugin: MediaSessionPlugin? = null

    @Volatile
    var latest: MediaUpdateArgs? = null
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "postNotification"),
    ],
)
class MediaSessionPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        MediaPlaybackHolder.plugin = this
    }

    fun emitControl(action: String) {
        val payload = JSObject()
        payload.put("action", action)
        trigger("control", payload)
    }

    @Command
    fun update(invoke: Invoke) {
        val args = invoke.parseArgs(MediaUpdateArgs::class.java)
        MediaPlaybackHolder.latest = args
        MediaPlaybackHolder.plugin = this
        maybeRequestNotificationPermission()
        val intent = Intent(activity, PlaybackService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                activity.startForegroundService(intent)
            } else {
                activity.startService(intent)
            }
            PlaybackService.instance?.publish()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject(e.message ?: "failed to start playback service")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        MediaPlaybackHolder.latest = null
        try {
            activity.stopService(Intent(activity, PlaybackService::class.java))
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject(e.message ?: "failed to stop playback service")
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2401)
        }
    }
}
