// The single data port the ChartHiddenSeriesContext shared surface binds to — the native analogue of the
// URL-state layer the web hook reads (web/src/hooks/useHiddenSeries.ts over web/src/hooks/useUrlState.ts
// `useUrlArray`, which itself wraps react-router's `useSearchParams`). The view (composable) performs NO
// work of its own; it only renders the projected state the ViewModel derives from this seam, satisfying
// the "data flows through the shared state holder" contract (P1/S8 boundary, ADR-002).
//
// The web persistence target is the page URL: `useUrlArray('hidden_{chartKey}')` reads a comma-joined,
// alphabetically-sorted list synchronously from `useSearchParams`, and its setter writes the array back
// (replacing history, dropping the param when the array is empty). That URL is a single process-wide,
// observable, shareable store keyed by param name — two charts with different keys read/write different
// params of the same URL. This seam is the native counterpart of exactly that store: [param] observes a
// named array param, [update] mutates it through a functional reducer (web `setArr(prev => …)`) and
// persists the canonical sorted form, and an empty result drops the param (web `omitDefault`). Like the
// web URL layer — and like the accepted VisuallyHidden surface's self-contained announcer — it is a
// self-contained state holder with no heavier store behind it, so its native counterpart is co-located
// with its sole consumer surface and exposed app-wide through [ProcessHiddenSeriesParamStore].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartHiddenSeriesContext) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located default
// implementation + process instance alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charthiddenseriescontext

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.ConcurrentHashMap

/**
 * The seam the [ChartHiddenSeriesViewModel] depends on so it binds to an abstraction (the real
 * process-wide param store ↔ a throwaway test instance), never to a concrete client or the network — the
 * Android analogue of the web `useSearchParams` / `useUrlArray` URL-state layer that backs
 * `useHiddenSeries` (the P1/S8 state-holder boundary for this surface).
 *
 * [param] observes the named array param as a hot [StateFlow] (web `useUrlArray` read); [update] mutates
 * it atomically through a reducer over the current hidden set (web `setArr(prev => …)`). Implementations
 * persist the canonical sorted form and drop the param when the reducer yields an empty set, so the
 * seam's contract matches the web URL layer exactly. No HTTP touches the view.
 */
interface HiddenSeriesParamStore {
    /**
     * Observes the array value stored under [name] as a hot [StateFlow] — the native mirror of the web
     * `useUrlArray(name)` read. Emits the current value immediately on subscription and re-emits on every
     * [update] to the same [name]; an absent param reads as an empty list.
     */
    fun param(name: String): StateFlow<List<String>>

    /**
     * Atomically replaces the value under [name] by applying [transform] to the current hidden set — the
     * native mirror of the web setter's `setArr(prev => next)`. The result is persisted in canonical
     * sorted order ([serializeHiddenSeries]); an empty result drops the param (web `omitDefault`).
     */
    fun update(
        name: String,
        transform: (Set<String>) -> Set<String>,
    )
}

/**
 * The default [HiddenSeriesParamStore] — a process-wide, in-memory, observable param store keyed by name,
 * the native analogue of the single page URL the web hook persists to. Each param is one
 * [MutableStateFlow] of its sorted string list; reads project it, writes parse it to a set, apply the
 * reducer, and store the canonical sorted form (an empty set stores an empty list, mirroring the web URL
 * dropping the param). Safe to share across surfaces and call from any thread — the per-name flows live
 * in a [ConcurrentHashMap] and each mutation is an atomic [MutableStateFlow.update].
 */
class SearchParamStore : HiddenSeriesParamStore {
    private val params = ConcurrentHashMap<String, MutableStateFlow<List<String>>>()

    private fun flowFor(name: String): MutableStateFlow<List<String>> = params.getOrPut(name) { MutableStateFlow(emptyList()) }

    override fun param(name: String): StateFlow<List<String>> = flowFor(name).asStateFlow()

    override fun update(
        name: String,
        transform: (Set<String>) -> Set<String>,
    ) {
        flowFor(name).update { current ->
            serializeHiddenSeries(transform(parseHiddenSeries(current)))
        }
    }
}

/**
 * The process-wide hidden-series param store — the native analogue of the single page URL every web
 * `useHiddenSeries` call site shares. The provider binds each chart's [ChartHiddenSeriesViewModel] to
 * this instance so two charts with different keys persist to different params of one shared store
 * (cross-surface, restart-stable within the process); a test constructs a throwaway [SearchParamStore]
 * so the shared instance is never polluted across cases.
 */
val ProcessHiddenSeriesParamStore: HiddenSeriesParamStore = SearchParamStore()
