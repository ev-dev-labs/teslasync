package io.teslasync.android.widgets

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.updateAll

/**
 * Re-renders the home-screen widgets (P3/A8). After a background refresh it stamps each widget
 * instance's Glance state with that widget's [WidgetSyncStatus] and asks Glance to recompose it from
 * the (now updated) cache; it can also force a plain re-render of every widget.
 */
object WidgetUpdater {
    private val widgets: List<Pair<WidgetKind, GlanceAppWidget>>
        get() =
            listOf(
                WidgetKind.VehicleStatus to VehicleStatusWidget(),
                WidgetKind.Charging to ChargingWidget(),
                WidgetKind.QuickStats to QuickStatsWidget(),
                WidgetKind.Alerts to AlertsWidget(),
            )

    /** Records [statuses] per widget kind and recomposes every instance from the refreshed cache. */
    suspend fun applyAndUpdate(
        context: Context,
        statuses: Map<WidgetKind, WidgetSyncStatus>,
        nowMillis: Long,
    ) {
        val manager = GlanceAppWidgetManager(context)
        for ((kind, widget) in widgets) {
            val status = statuses[kind] ?: WidgetSyncStatus.Unknown
            for (glanceId in manager.getGlanceIds(widget.javaClass)) {
                WidgetSyncState.write(context, glanceId, status, nowMillis)
                widget.update(context, glanceId)
            }
        }
    }

    /** Recomposes every widget instance from the current cache (no sync-status change). */
    suspend fun updateAll(context: Context) {
        for ((_, widget) in widgets) {
            widget.updateAll(context)
        }
    }

    /** True when at least one instance of any TeslaSync widget is currently placed on a home screen. */
    suspend fun hasAnyWidgets(context: Context): Boolean {
        val manager = GlanceAppWidgetManager(context)
        return widgets.any { (_, widget) -> manager.getGlanceIds(widget.javaClass).isNotEmpty() }
    }
}
