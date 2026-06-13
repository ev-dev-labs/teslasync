// UI-thread-free state holder backing the ChartLegend surface — the native port of the web
// `useChartHiddenSeries` subscription the web `ChartLegend` performs (web/src/components/charts/ChartLegend.tsx
// reading web/src/components/charts/ChartHiddenSeriesContext.tsx). It binds the [ChartHiddenSeriesStore]
// seam (P1/S8), re-shares the current hidden set for its `chartKey` as a lifecycle-aware [StateFlow]
// (collected only while the legend is on-screen), exposes [toggle] / [reset] for the view, and emits the
// PII-safe one-shot `view.opened` diagnostic. The view never performs work of its own — it only collects
// [hidden] and calls [toggle] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartLegend) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartlegend

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `ChartLegend` — the Android port of the web `ChartLegend` over the
 * `useChartHiddenSeries` toggle source.
 *
 * It re-shares the injected [store]'s hidden set for [chartKey] (the P1/S8 boundary) as a
 * lifecycle-aware [hidden] flow, so the legend reflects the latest toggle without owning any state
 * itself. The store is a client-side visibility cache, not a cache-then-network feed, so there is no
 * loading / empty / error / stale / offline lifecycle to project (the same rationale the accepted
 * VisuallyHidden / RouteAnnouncer ports document); the surface's states are the empty / passive /
 * interactive legends the composable derives from [hidden] and the caller's series. The view stays a
 * thin renderer (ADR-002).
 *
 * [toggle] flips one series' visibility (web `resolved.toggle(key)`) and emits the PII-safe toggle
 * diagnostic; [reset] clears the chart; [onViewOpened] emits the P1/S11 `view.opened` event exactly once
 * per surface open.
 *
 * @param chartKey the stable chart namespace the hidden set is keyed by (web `chartKey`).
 * @param store the shared hidden-series seam (the process singleton in production, a fresh instance in
 *   tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
class ChartLegendViewModel(
    private val chartKey: String,
    private val store: ChartHiddenSeriesStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The live hidden series-key set for [chartKey] (web `hidden`), collected only while observed. */
    val hidden: StateFlow<Set<String>> =
        store.hidden(chartKey).stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = store.hidden(chartKey).value,
        )

    /**
     * Flips [seriesKey]'s visibility through the shared store (web `resolved.toggle(key)`) and logs the
     * PII-safe toggle diagnostic — the surface slug only, never the series key.
     */
    fun toggle(seriesKey: String) {
        store.toggle(chartKey, seriesKey)
        recordChartLegendToggle(logger)
    }

    /** Clears every hidden flag for this chart (web `reset`), making all of its series visible again. */
    fun reset() {
        store.reset(chartKey)
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChartLegendOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for [chartKey]. */
        fun factory(
            chartKey: String,
            store: ChartHiddenSeriesStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ChartLegendViewModel(chartKey, store, logger) }
            }
    }
}
