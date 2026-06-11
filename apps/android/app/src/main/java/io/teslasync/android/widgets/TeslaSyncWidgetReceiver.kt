package io.teslasync.android.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/**
 * Base Glance widget receiver for the four TeslaSync widgets (P3/A8). It owns the responsible refresh
 * scheduling shared by every widget: the unique periodic WorkManager job is (re)scheduled whenever a
 * widget is enabled or updated, and a coalesced one-shot is enqueued on update so a freshly-added
 * widget populates quickly. Concrete receivers only supply their `glanceAppWidget`.
 */
abstract class TeslaSyncWidgetReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        WidgetRefreshScheduler.schedulePeriodic(context)
        WidgetRefreshScheduler.enqueueOneTime(context)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetRefreshScheduler.schedulePeriodic(context)
    }
}
