// The hidden-series toggle store the ChartLegend surface binds to, plus its process-wide production
// instance — the native port of the web toggle source `useChartHiddenSeries`
// (web/src/components/charts/ChartHiddenSeriesContext.tsx), itself backed by `useHiddenSeries`
// (URL state, web/src/hooks/useHiddenSeries.ts) or `useChartLegendState` (localStorage,
// web/src/components/charts/useChartLegendState.ts). The view (composable) performs NO work of its own;
// it only renders the projected state the ViewModel derives from this seam, satisfying the "data flows
// through the shared state holder" contract (ADR-002). No HTTP touches the view — this is a client-side
// visibility store, exactly like the web source.
//
// The web source keys a hidden `Set<dataKey>` by a stable `chartKey` and exposes `isHidden` / `toggle` /
// `reset`; web persistence is the browser URL (shareable deep-links) or localStorage (survives reload).
// This seam mirrors the toggle contract 1:1: [hidden] streams the current hidden set for a chart,
// [toggle] flips one series, [reset] clears the chart. The CANONICAL hidden state lives in this store
// for the process lifetime (the [InMemoryChartHiddenSeriesStore] below); durable cross-launch
// persistence (the web URL / localStorage analogue — SavedStateHandle / DataStore) is host wiring a
// scaffold layers on by hydrating the store, and is outside this surface's allowed files, so it is not
// invented here (Honesty Covenant: no scope narrowing, documented not silent).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartLegend) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartlegend

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.ConcurrentHashMap

/**
 * The single seam the [ChartLegendViewModel] depends on so it binds to an abstraction (the real process
 * store ↔ a throwaway test instance), never to a concrete client — the Android analogue of the web
 * `useChartHiddenSeries` toggle source (the P1/S8 state-holder boundary for this surface).
 *
 * [hidden] streams the current hidden series-key set for [chartKey] (web `hidden`); [toggle] flips one
 * series (web `toggle`); [reset] clears the chart (web `reset`). Implementations key state by chart so a
 * page with several charts toggles each independently, exactly as the web hooks namespace by `chartKey`.
 */
interface ChartHiddenSeriesStore {
    /** The live hidden-key set for [chartKey] — emits a fresh value on every [toggle] / [reset]. */
    fun hidden(chartKey: String): StateFlow<Set<String>>

    /** Flips [seriesKey] for [chartKey] (web `toggle`): hides it when shown, shows it when hidden. */
    fun toggle(
        chartKey: String,
        seriesKey: String,
    )

    /** Clears every hidden flag for [chartKey] (web `reset`), making all of its series visible again. */
    fun reset(chartKey: String)
}

/**
 * The default [ChartHiddenSeriesStore] — a per-chart [MutableStateFlow] map, the native analogue of the
 * web hook's per-`chartKey` hidden set. Each [toggle] applies the pure [ChartLegendProjection.toggleHidden]
 * so the seam's contract matches the web `toggle` exactly. Thread-safe: the chart→flow map is a
 * [ConcurrentHashMap] and `MutableStateFlow.update` applies its mutation atomically, so a swipe on the
 * UI thread and a hydrate on a background thread never corrupt the set.
 */
class InMemoryChartHiddenSeriesStore : ChartHiddenSeriesStore {
    private val flows = ConcurrentHashMap<String, MutableStateFlow<Set<String>>>()

    private fun flowFor(chartKey: String): MutableStateFlow<Set<String>> = flows.getOrPut(chartKey) { MutableStateFlow(emptySet()) }

    override fun hidden(chartKey: String): StateFlow<Set<String>> = flowFor(chartKey).asStateFlow()

    override fun toggle(
        chartKey: String,
        seriesKey: String,
    ) {
        flowFor(chartKey).update { current -> ChartLegendProjection.toggleHidden(current, seriesKey) }
    }

    override fun reset(chartKey: String) {
        flowFor(chartKey).update { emptySet() }
    }
}

/**
 * The process-wide hidden-series store singleton — the native analogue of the web module-level toggle
 * source every chart on a page shares through context. A host binds a `ChartLegend` over this instance
 * and the matching chart reads the same hidden set to drop its series; a test constructs a throwaway
 * [InMemoryChartHiddenSeriesStore] so the singleton is never polluted across cases.
 */
val ProcessChartHiddenSeriesStore: ChartHiddenSeriesStore = InMemoryChartHiddenSeriesStore()
