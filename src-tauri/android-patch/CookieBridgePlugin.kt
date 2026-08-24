package top.nexmusic.app

import android.webkit.CookieManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class CookieArgs {
    var url: String = ""
}

@TauriPlugin
class CookieBridgePlugin(private val activity: android.app.Activity) : Plugin(activity) {
    @Command
    fun getCookies(invoke: Invoke) {
        val args = invoke.parseArgs(CookieArgs::class.java)
        val cookie = CookieManager.getInstance().getCookie(args.url) ?: ""
        val ret = JSObject()
        ret.put("cookie", cookie)
        invoke.resolve(ret)
    }
}
