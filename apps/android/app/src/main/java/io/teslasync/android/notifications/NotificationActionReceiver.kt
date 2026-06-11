package io.teslasync.android.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/**
 * The broadcast contract for a background notification action (P3/A8). An
 * [NotificationActionBehavior.Acknowledge] action fires this broadcast (rather than opening the app)
 * carrying the action token and the OS notification id to cancel. Kept in one place so the presenter
 * that builds the `PendingIntent` and the [NotificationActionReceiver] that handles it never drift.
 */
object NotificationActionIntent {
    /** The broadcast action the receiver is registered for. */
    const val ACTION = "io.teslasync.android.intent.NOTIFICATION_ACTION"

    /** Extra: the [NotificationActionId.wire] token of the invoked action. */
    const val EXTRA_ACTION = "io.teslasync.android.intent.ACTION_ID"

    /** Extra: the OS notification id to cancel when the action is handled in the background. */
    const val EXTRA_NOTIFICATION_ID = "io.teslasync.android.intent.NOTIFICATION_ID"

    /** Builds the broadcast [Intent] for [actionId] targeting [NotificationActionReceiver]. */
    fun broadcast(
        context: Context,
        actionId: NotificationActionId,
        notificationId: Int,
    ): Intent =
        Intent(context, NotificationActionReceiver::class.java).apply {
            action = ACTION
            putExtra(EXTRA_ACTION, actionId.wire)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
}

/**
 * Handles a background notification action (P3/A8, ADR-009). Currently the only background action is
 * **acknowledge**, which dismisses the device notification surface so it stops nagging — it never opens
 * the app and reveals nothing, so it is safe from the lock screen (the open-style actions instead carry
 * `setAuthenticationRequired`). The authoritative server-side read/acknowledge state is reconciled when
 * the user opens the in-app inbox/alert via the companion "Open" action.
 */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val actionId = NotificationActionId.fromWire(intent.getStringExtra(NotificationActionIntent.EXTRA_ACTION))
        val isAcknowledge = intent.action == NotificationActionIntent.ACTION && actionId == NotificationActionId.Acknowledge
        if (isAcknowledge) {
            val notificationId = intent.getIntExtra(NotificationActionIntent.EXTRA_NOTIFICATION_ID, 0)
            NotificationManagerCompat.from(context).cancel(notificationId)
        }
    }
}
