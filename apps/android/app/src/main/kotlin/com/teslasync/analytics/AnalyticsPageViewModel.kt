// The state holder backing the AnalyticsPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hook (web/src/features/analytics/pages/AnalyticsPage.tsx). It owns the page's local
// interaction state (the active tab + the selected date-range preset) as a single immutable
// [AnalyticsInteraction] snapshot, and projects the single cache-then-network read (`GET /analytics/fleet`)
// onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], decoding the raw SI
// `JsonElement` into the typed [FleetAnalytics] model on the way through. The feed re-collects only when the
// range changes (a new `?days=` read, web `useFleetAnalytics({ start, end })`) or the refresh trigger bumps —
// switching tabs is pure local UI state and never re-fetches, mirroring the web `useState` tab + `useRangeState`
// split. All derivation logic lives in the framework-free model (AnalyticsPageModel.kt); this holder performs
// no HTTP and no unit math.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The page's local interaction snapshot — the union of the web component's `activeTab` `useState` and the
 * `useRangeState` preset, folded into one immutable value so the composable reads a single source. Defaults
 * mirror the web (`activeTab = 'overview'`, range `defaultPresetId: '30d'`).
 */
data class AnalyticsInteraction(
    val tab: AnalyticsTab = AnalyticsTab.OVERVIEW,
    val range: AnalyticsRange = AnalyticsRange.DEFAULT,
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.analytics.AnalyticsStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnalyticsPageViewModel(
    private val source: AnalyticsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(AnalyticsInteraction())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `activeTab` `useState` + `useRangeState`). */
    val interaction: StateFlow<AnalyticsInteraction> = mutableInteraction.asStateFlow()

    /**
     * The fleet deep-analytics report as cache-then-network UI state (loading / content / stale / offline /
     * error). Re-collected whenever the range preset changes (a new `?days=` read, web
     * `useFleetAnalytics({ start, end })`) or the refresh trigger bumps; switching tabs does not re-fetch. The
     * raw SI `JsonElement` is decoded to the typed [FleetAnalytics] here. The empty predicate is fixed `false`:
     * like the web page, a parsed payload always renders the hero + tabs (every panel owns its own empty
     * state), so the page never collapses to a single page-level empty surface.
     */
    val state: StateFlow<UiState<FleetAnalytics>> =
        combine(
            mutableInteraction.map { it.range }.distinctUntilChanged(),
            refreshTrigger,
        ) { range, _ -> range }
            .flatMapLatest { range -> source.fleetAnalytics(range.days).map { it.toFleetResource() } }
            .asUiState(isEmpty = { false })

    // ── Interaction setters (web `setActiveTab` / `setRange`) ────────────────────────────────────────────────

    /** Switch the active tab (web `setActiveTab`); pure local state — does not re-fetch. */
    fun setTab(tab: AnalyticsTab): Unit = mutableInteraction.update { it.copy(tab = tab) }

    /** Choose the date-range preset (web `RangePicker onChange` ▸ `setRange`); re-collects the feed. */
    fun setRange(range: AnalyticsRange): Unit = mutableInteraction.update { it.copy(range = range) }

    // ── Refresh / retry (web query `refetch` + the error-state retry) ────────────────────────────────────────

    /** Re-fetch the active range's feed (the web query `refetch` / error-retry affordance). */
    fun refresh() {
        logger.info("analytics.refresh")
        source.refresh(mutableInteraction.value.range.days)
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAnalyticsPageOpened(logger)
    }

    /**
     * Decodes a raw-JSON [Resource] into a typed [FleetAnalytics] [Resource], preserving the cache-then-network
     * contract exactly: a `null` cached element stays `null` (so a first load shows the spinner rather than an
     * empty model), while any present element is parsed via [FleetAnalytics.from]. No phase, freshness, or error
     * is altered — only the payload type.
     */
    private fun Resource<JsonElement>.toFleetResource(): Resource<FleetAnalytics> =
        when (this) {
            is Resource.Loading ->
                Resource.Loading(cached = cached?.let { FleetAnalytics.from(it) }, fetchedAt = fetchedAt, stale = stale)
            is Resource.Success ->
                Resource.Success(data = FleetAnalytics.from(data), fetchedAt = fetchedAt, stale = stale)
            is Resource.Error ->
                Resource.Error(
                    cached = cached?.let { FleetAnalytics.from(it) },
                    fetchedAt = fetchedAt,
                    stale = stale,
                    error = error,
                )
        }
}
