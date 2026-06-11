package io.teslasync.android.notifications

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.teslasync.android.MainActivity
import io.teslasync.android.R

/**
 * Presents a background OS notification for a [NotificationContent] (P3/A6). The tap opens
 * [MainActivity] carrying the notification's deep-link URI in a private extra
 * ([NotificationIntent.EXTRA_DEEP_LINK]) so the navigation shell routes it into the graph.
 */
interface SystemNotificationPresenter {
    /** Posts (or updates) the OS notification for [content] on its channel. */
    fun show(content: NotificationContent)
}

/**
 * The production [SystemNotificationPresenter] over [NotificationManagerCompat] (P3/A6). The
 * notification is posted on the content's channel with an immutable [PendingIntent] that re-launches
 * the single app Activity carrying the deep-link extra. A blank title falls back to the app name so
 * the OS surface always has a visible title.
 */
class AndroidSystemNotificationPresenter(
    context: Context,
) : SystemNotificationPresenter {
    private val appContext = context.applicationContext

    // The MissingPermission lint cannot see the cross-layer gating; the post is guarded here by
    // areNotificationsEnabled() and upstream by NotificationDeliveryPolicy (which only emits a system
    // notification when the runtime POST_NOTIFICATIONS grant is present), and the manifest declares it.
    @SuppressLint("MissingPermission")
    override fun show(content: NotificationContent) {
        val manager = NotificationManagerCompat.from(appContext)
        // Defensive: never post when the user has turned notifications off (or not granted the 33+ permission).
        if (!manager.areNotificationsEnabled()) return

        val title = content.title.ifBlank { appContext.getString(R.string.app_name) }
        val notification =
            NotificationCompat
                .Builder(appContext, content.channelId)
                .setSmallIcon(R.drawable.ic_stat_notification)
                .setContentTitle(title)
                .setContentText(content.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(content.body))
                .setPriority(priorityOf(content.severity))
                .setAutoCancel(true)
                .setContentIntent(deepLinkIntent(content.deepLinkUri))
                .build()

        manager.notify(content.deepLinkUri.hashCode(), notification)
    }

    private fun deepLinkIntent(deepLinkUri: String): PendingIntent {
        val intent =
            Intent(appContext, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(NotificationIntent.EXTRA_DEEP_LINK, deepLinkUri)
            }
        return PendingIntent.getActivity(
            appContext,
            deepLinkUri.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun priorityOf(severity: BannerSeverity): Int =
        when (severity) {
            BannerSeverity.Critical -> NotificationCompat.PRIORITY_HIGH
            BannerSeverity.Warning -> NotificationCompat.PRIORITY_DEFAULT
            BannerSeverity.Info -> NotificationCompat.PRIORITY_LOW
        }
}
