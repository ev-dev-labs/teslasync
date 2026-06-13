// UI-thread-free state holder backing the ChartHiddenSeriesContext surface — the native port of the web
// `ChartHiddenSeriesProviderInner`'s `useHiddenSeries(chartKey)` binding
// (web/src/components/charts/ChartHiddenSeriesContext.tsx over web/src/hooks/useHiddenSeries.ts). It binds
// the [HiddenSeriesParamStore] seam (P1/S8) for the chart's param, projects each emission into the
// immutable [HiddenSeriesState] context value (parsing the stored list into the hidden set and attaching
// the toggle/reset actions), exposes those actions, and emits the PII-safe one-shot `view.opened`
// diagnostic. The view never performs work of its own — it only collects [state] and renders it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartHiddenSeriesContext) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed because the file follows the surface's `{Surface}ViewModel.kt`
// naming (ChartHiddenSeriesContextViewModel.kt) while the holder it declares is the concise
// [ChartHiddenSeriesViewModel] — the same package/naming divergence the sibling files in this surface
// document.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charthiddenseriescontext

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose [ChartHiddenSeriesProvider] — the Android port of the web
 * `ChartHiddenSeriesProviderInner` over `useHiddenSeries(chartKey)`.
 *
 * It binds the injected [HiddenSeriesParamStore] seam (the P1/S8 boundary) for [chartKey]'s param for its
 * whole lifetime and projects each emission into the [HiddenSeriesState] context value — parsing the
 * stored list into the hidden set and attaching [toggle] / [reset] — so the provided context always
 * reflects the URL-persisted toggle state. The store is an observable param holder, not a
 * cache-then-network feed, so there is no loading / empty / error / stale / offline lifecycle to project
 * (the same rationale the accepted VisuallyHidden / AIChatbotIndicator siblings document); the surface's
 * states are the absent / all-visible / some-hidden context values the projected [state] already
 * expresses. The view stays a thin renderer (ADR-002).
 *
 * [toggle] flips a series' visibility and [reset] clears every flag, both persisting through the store
 * (web `toggle` / `reset`); [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once
 * per surface open.
 *
 * @param store the shared hidden-series param store seam (the process instance in production, a fresh
 *   instance in tests). The view-model owns no networking — it only reduces this port's emissions.
 * @param chartKey the chart whose `hidden_{chartKey}` param this holder binds (web
 *   `useHiddenSeries(chartKey)` argument).
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event
 *   carrying only the non-PII surface slug.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ChartHiddenSeriesViewModel(
    private val store: HiddenSeriesParamStore,
    private val chartKey: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val paramName = hiddenParamName(chartKey)
    private var viewOpenedRecorded = false
    private val mutableState = MutableStateFlow(stateFrom(store.param(paramName).value))

    /** The URL-persisted hidden-series context value for [chartKey] (web `useHiddenSeries` result). */
    val state: StateFlow<HiddenSeriesState> = mutableState.asStateFlow()

    init {
        // Bind the chart's param for the holder's lifetime so every persisted change re-projects the
        // context value (web `useHiddenSeries` re-deriving from `useSearchParams`).
        launch { store.param(paramName).collect { values -> mutableState.value = stateFrom(values) } }
    }

    /**
     * Flips [seriesKey]'s visibility, persisting the canonical sorted param through the store — the web
     * `toggle`. The collected param flow re-projects [state], so callers never mutate it directly.
     */
    fun toggle(seriesKey: String) {
        store.update(paramName) { current -> toggleHiddenSeries(current, seriesKey) }
    }

    /** Clears every hidden flag for the chart, dropping the param (web `reset`). */
    fun reset() {
        store.update(paramName) { emptySet() }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no chart id or hidden `dataKey`, so a diagnostics line can never leak fleet state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChartHiddenSeriesOpened(logger)
    }

    /** Projects a stored param value into the [HiddenSeriesState] context value, wiring the actions. */
    private fun stateFrom(values: List<String>): HiddenSeriesState =
        HiddenSeriesState(
            chartKey = chartKey,
            hidden = parseHiddenSeries(values),
            toggle = ::toggle,
            reset = ::reset,
        )

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's per-chart ViewModel. */
        fun factory(
            store: HiddenSeriesParamStore,
            chartKey: String,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ChartHiddenSeriesViewModel(store, chartKey, logger) }
            }
    }
}
