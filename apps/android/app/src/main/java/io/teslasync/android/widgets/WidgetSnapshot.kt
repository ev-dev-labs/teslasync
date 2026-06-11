package io.teslasync.android.widgets

/**
 * The complete, render-ready state a widget draws (P3/A8): the mutually-exclusive [renderState], the
 * display-ready [content] (present whenever there is something to show, even when [WidgetRenderState.Stale]
 * or [WidgetRenderState.Offline]), and the [freshness] for the "updated X ago" / stale labelling.
 *
 * It is produced by [WidgetSnapshotMapper] from cached shared-core data and the last background-sync
 * outcome, and consumed by the Glance composables — which add no logic of their own. Holding both the
 * data and its freshness means a stale/offline value is shown with an honest banner, never blanked and
 * never presented as live.
 */
data class WidgetSnapshot<out T>(
    val renderState: WidgetRenderState,
    val content: T?,
    val freshness: WidgetFreshness,
) {
    /** True when a value is available to render regardless of state (content/stale/offline/empty-with-data). */
    val hasContent: Boolean get() = content != null

    companion object {
        /** The pre-sync seed (cold widget): loading, no content, no freshness. */
        fun <T> loading(): WidgetSnapshot<T> =
            WidgetSnapshot(renderState = WidgetRenderState.Loading, content = null, freshness = WidgetFreshness.Unknown)
    }
}

/** The vehicle-status widget's snapshot. */
typealias VehicleStatusSnapshot = WidgetSnapshot<VehicleStatusContent>

/** The charging widget's snapshot. */
typealias ChargingSnapshot = WidgetSnapshot<ChargingContent>

/** The quick-stats widget's snapshot. */
typealias QuickStatsSnapshot = WidgetSnapshot<QuickStatsContent>

/** The alerts widget's snapshot. */
typealias AlertsSnapshot = WidgetSnapshot<AlertsContent>
