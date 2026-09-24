package top.nexmusic.app

import android.graphics.Color
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
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
    private var overlay: FrameLayout? = null
    private var webView: WebView? = null

    @Command
    fun getCookies(invoke: Invoke) {
        val args = invoke.parseArgs(CookieArgs::class.java)
        val cm = CookieManager.getInstance()
        val urls = listOf(
            args.url,
            "https://y.qq.com/",
            "https://y.qq.com/n/ryqq/player",
            "https://i.y.qq.com/",
            "https://u.y.qq.com/",
            "https://c.y.qq.com/",
            "https://graph.qq.com/",
            "https://xui.ptlogin2.qq.com/",
            "https://www.kugou.com/",
            "https://music.163.com/",
        ).filter { it.isNotBlank() }.distinct()
        val cookie = urls.mapNotNull { cm.getCookie(it) }.filter { it.isNotBlank() }.joinToString("; ")
        val ret = JSObject()
        ret.put("cookie", cookie)
        invoke.resolve(ret)
    }

    @Command
    fun openLogin(invoke: Invoke) {
        val args = invoke.parseArgs(CookieArgs::class.java)
        activity.runOnUiThread {
            try {
                showOverlay(args.url.ifBlank { "https://y.qq.com/n/ryqq/profile" })
                invoke.resolve(JSObject())
            } catch (e: Exception) {
                invoke.reject(e.message ?: "open login failed")
            }
        }
    }

    @Command
    fun navigateLogin(invoke: Invoke) {
        val args = invoke.parseArgs(CookieArgs::class.java)
        activity.runOnUiThread {
            webView?.loadUrl(args.url)
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun closeLogin(invoke: Invoke) {
        activity.runOnUiThread {
            hideOverlay()
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun leaveApp(invoke: Invoke) {
        activity.runOnUiThread {
            activity.moveTaskToBack(true)
            invoke.resolve(JSObject())
        }
    }

    override fun load(webView: WebView) {
        try {
            val act = activity
            if (act is androidx.activity.ComponentActivity) {
                act.onBackPressedDispatcher.addCallback(
                    act,
                    object : androidx.activity.OnBackPressedCallback(true) {
                        override fun handleOnBackPressed() {
                            val loginWv = this@CookieBridgePlugin.webView
                            if (loginWv != null && loginWv.canGoBack()) {
                                loginWv.goBack()
                                return
                            }
                            if (overlay != null) {
                                hideOverlay()
                                return
                            }
                            trigger("appBack", JSObject())
                        }
                    },
                )
            }
        } catch (_: Exception) {
        }
    }
        val ret = JSObject()
        var handled = false
        activity.runOnUiThread {
            val wv = webView
            if (wv != null && wv.canGoBack()) {
                wv.goBack()
                handled = true
            } else if (overlay != null) {
                hideOverlay()
                handled = true
            }
            ret.put("handled", handled)
            invoke.resolve(ret)
        }
    }

    private fun showOverlay(url: String) {
        if (overlay != null) {
            webView?.loadUrl(url)
            return
        }
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        val frame = FrameLayout(activity)
        frame.setBackgroundColor(Color.parseColor("#111111"))
        frame.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )

        val bar = TextView(activity).apply {
            text = "  在此页完成登录（不要跳到系统浏览器）          关闭"
            setTextColor(Color.WHITE)
            textSize = 14f
            setBackgroundColor(Color.parseColor("#1A1A1A"))
            setPadding(24, 28, 24, 28)
            gravity = Gravity.CENTER_VERTICAL
            setOnClickListener { hideOverlay() }
        }
        val barLp = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        bar.layoutParams = barLp

        val wv = WebView(activity)
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = true
        wv.settings.databaseEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.webViewClient = WebViewClient()
        wv.webChromeClient = WebChromeClient()
        wv.loadUrl(url)
        val wvLp = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        wvLp.topMargin = 120
        wv.layoutParams = wvLp

        frame.addView(wv)
        frame.addView(bar)
        root.addView(frame)
        overlay = frame
        webView = wv
    }

    private fun hideOverlay() {
        overlay?.let { frame ->
            (frame.parent as? ViewGroup)?.removeView(frame)
        }
        webView?.destroy()
        webView = null
        overlay = null
    }
}
