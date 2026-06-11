package io.teslasync.android.widgets

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback

/**
 * The Glance action behind a widget's offline/error retry tap (P3/A8): it enqueues a one-shot
 * [WidgetRefreshWorker] rather than refreshing inline, so the retry obeys the same WorkManager
 * constraints/backoff as the scheduled refresh and never blocks the widget's click handling.
 */
class WidgetRefreshAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        WidgetRefreshScheduler.enqueueOneTime(context)
    }
}
