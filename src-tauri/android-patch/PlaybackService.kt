package top.nexmusic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL

class PlaybackService : Service() {
    private var session: MediaSession? = null
    private var coverBmp: Bitmap? = null
    private var coverUrl: String = ""
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        instance = this
        ensureChannel()
        session = MediaSession(this, "NexMusic").apply {
            setCallback(
                object : MediaSession.Callback() {
                    override fun onPlay() = emit("play")
                    override fun onPause() = emit("pause")
                    override fun onSkipToNext() = emit("next")
                    override fun onSkipToPrevious() = emit("prev")
                },
            )
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        publish()
        return START_STICKY
    }

    override fun onDestroy() {
        session?.isActive = false
        session?.release()
        session = null
        instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    fun publish() {
        val args = MediaPlaybackHolder.latest ?: return
        val sess = session ?: return
        val playing = args.playing
        val duration = args.durationMs.coerceAtLeast(0L)
        val position = args.positionMs.coerceAtLeast(0L)

        sess.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, args.title.ifBlank { "NexMusic" })
                .putString(MediaMetadata.METADATA_KEY_ARTIST, args.artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM_ART_URL, args.cover)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
                .apply {
                    coverBmp?.let { putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) }
                }
                .build(),
        )
        sess.setPlaybackState(
            PlaybackState.Builder()
                .setActions(ACTIONS)
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    position,
                    if (playing) 1f else 0f,
                )
                .build(),
        )

        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val contentPi = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(args.title.ifBlank { "NexMusic" })
            .setContentText(args.artist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentPi)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setStyle(Notification.MediaStyle().setMediaSession(sess.sessionToken))

        coverBmp?.let { builder.setLargeIcon(it) }

        val notification = builder.build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIF_ID, notification)
        }

        maybeLoadCover(args.cover)
    }

    private fun maybeLoadCover(url: String) {
        if (url.isBlank() || url == coverUrl) return
        coverUrl = url
        Thread {
            val bmp = decodeBitmap(url)
            main.post {
                if (coverUrl == url) {
                    coverBmp = bmp
                    publish()
                }
            }
        }.start()
    }

    private fun decodeBitmap(url: String): Bitmap? {
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 4000
            conn.readTimeout = 4000
            conn.instanceFollowRedirects = true
            conn.inputStream.use { BitmapFactory.decodeStream(it) }
        } catch (_: Exception) {
            null
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java)
        val existing = nm.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "正在播放",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                setShowBadge(false)
                description = "NexMusic 播放控制"
            },
        )
    }

    private fun emit(action: String) {
        MediaPlaybackHolder.plugin?.emitControl(action)
    }

    companion object {
        const val CHANNEL_ID = "nexmusic_playback"
        const val NOTIF_ID = 1001
        private const val ACTIONS =
            PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_SKIP_TO_NEXT or
                PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                PlaybackState.ACTION_STOP

        @Volatile
        var instance: PlaybackService? = null
    }
}
