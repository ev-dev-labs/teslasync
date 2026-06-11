package io.teslasync.android.notifications

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
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
 *
 * P3/A8 adds action buttons ([NotificationContent.actions]): an **open** action launches the Activity
 * at a deep link (with `setAuthenticationRequired` so a locked device must be unlocked first — the
 * lock-state safeguard, applied by `NotificationCompat` on API 31+), while **acknowledge** broadcasts
 * to [NotificationActionReceiver] to dismiss the notification in the background without opening the app.
 * The notification is posted [VISIBILITY_PRIVATE][NotificationCompat.VISIBILITY_PRIVATE] so its content
 * is hidden on a secure lock screen.
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
        val notificationId = content.deepLinkUri.hashCode()
        val builder =
            NotificationCompat
                .Builder(appContext, content.channelId)
                .setSmallIcon(R.drawable.ic_stat_notification)
                .setContentTitle(title)
                .setContentText(content.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(content.body))
                .setPriority(priorityOf(content.severity))
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(openIntent(content.deepLinkUri, notificationId))

        content.actions.forEach { action -> builder.addAction(buildAction(action, notificationId)) }

        manager.notify(notificationId, builder.build())
    }

    private fun buildAction(
        action: NotificationAction,
        notificationId: Int,
    ): NotificationCompat.Action {
        val pendingIntent =
            when (action.behavior) {
                NotificationActionBehavior.Open -> {
                    val uri = NotificationRouteMap.deepLinkUriFor(action.deepLinkPath ?: NotificationRouteMap.INBOX_PATH)
                    openIntent(uri, requestCode(notificationId, action.id))
                }
                NotificationActionBehavior.Acknowledge -> acknowledgeIntent(notificationId, action.id)
            }
        return NotificationCompat.Action
            .Builder(actionIcon(action.id), appContext.getString(actionLabel(action.id)), pendingIntent)
            .setAuthenticationRequired(action.authRequired)
            .build()
    }

    private fun openIntent(
        deepLinkUri: String,
        requestCode: Int,
    ): PendingIntent {
        val intent =
            Intent(appContext, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(NotificationIntent.EXTRA_DEEP_LINK, deepLinkUri)
            }
        return PendingIntent.getActivity(
            appContext,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun acknowledgeIntent(
        notificationId: Int,
        actionId: NotificationActionId,
    ): PendingIntent =
        PendingIntent.getBroadcast(
            appContext,
            requestCode(notificationId, actionId),
            NotificationActionIntent.broadcast(appContext, actionId, notificationId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun requestCode(
        notificationId: Int,
        actionId: NotificationActionId,
    ): Int = notificationId * REQUEST_CODE_PRIME + actionId.ordinal

    @StringRes
    private fun actionLabel(id: NotificationActionId): Int =
        when (id) {
            NotificationActionId.Open -> R.string.notif_action_open
            NotificationActionId.Acknowledge -> R.string.notif_action_acknowledge
            NotificationActionId.OpenSession -> R.string.notif_action_open_session
            NotificationActionId.OpenHistory -> R.string.notif_action_open_history
            NotificationActionId.OpenIncident -> R.string.notif_action_open_incident
            NotificationActionId.SignIn -> R.string.notif_action_sign_in
            NotificationActionId.QuietHours -> R.string.notif_action_quiet_hours
        }

    @DrawableRes
    private fun actionIcon(id: NotificationActionId): Int =
        when (id) {
            NotificationActionId.Acknowledge -> R.drawable.ic_action_acknowledge
            NotificationActionId.QuietHours -> R.drawable.ic_action_quiet_hours
            else -> R.drawable.ic_action_open
        }

    private fun priorityOf(severity: BannerSeverity): Int =
        when (severity) {
            BannerSeverity.Critical -> NotificationCompat.PRIORITY_HIGH
            BannerSeverity.Warning -> NotificationCompat.PRIORITY_DEFAULT
            BannerSeverity.Info -> NotificationCompat.PRIORITY_LOW
        }

    private companion object {
        const val REQUEST_CODE_PRIME = 31
    }
}
