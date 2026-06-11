package io.teslasync.android.widgets

import android.content.Context
import android.content.Intent
import androidx.glance.action.Action
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import io.teslasync.android.MainActivity
import io.teslasync.android.notifications.NotificationIntent

/**
 * Builds the click [Action]s for the widgets (P3/A8). A widget tap opens the app at the widget's exact
 * Navigation-Compose route; it does so by handing the validated `teslasync://app/...` URI to
 * `MainActivity` through the same private [NotificationIntent.EXTRA_DEEP_LINK] extra the notification
 * taps use (P3/A6), so it flows through the one tested `DeepLinkRouter` → navigation path and is never
 * double-handled by the NavHost's automatic intent deep-linking.
 */
object WidgetActions {
    /** The launch intent for [kind] (optionally pinned to [vehicleId]) carrying the deep-link extra. */
    fun openAppIntent(
        context: Context,
        kind: WidgetKind,
        vehicleId: Long? = null,
    ): Intent =
        Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(NotificationIntent.EXTRA_DEEP_LINK, WidgetDeepLinks.uri(kind, vehicleId))
        }

    /** A Glance action that opens the app at [kind]'s route (the whole-widget tap target). */
    fun openApp(
        context: Context,
        kind: WidgetKind,
        vehicleId: Long? = null,
    ): Action = actionStartActivity(openAppIntent(context, kind, vehicleId))

    /** A Glance action that triggers an on-demand background refresh (the offline/error retry tap). */
    fun retry(): Action = actionRunCallback<WidgetRefreshAction>()
}
