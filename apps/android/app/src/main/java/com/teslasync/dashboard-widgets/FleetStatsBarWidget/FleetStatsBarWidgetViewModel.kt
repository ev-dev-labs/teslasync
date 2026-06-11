// UI-thread-free state holder backing the Fleet Stats Bar widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx). It binds
// the shared data feeds (P1/S8) through [FleetStatsBarSource]: it COMBINES the `useVehicles` enrolled
// list with the `useFleetAnalytics(30)` cache-then-network `/analytics/fleet` envelope into a single
// [UiState] surface (loading / content / empty / stale / offline / error) via [combineFleetStats], and
// derives the display preferences (distance unit) separately from the live `/settings` feed
// (web `useUnits`). It exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [state] / [displayPrefs] and calls [refresh] /
// [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FleetStatsBarWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstatsbar

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetStatsBarWidgetViewModel(
    private val source: FleetStatsBarSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined vehicles + fleet-analytics payload as cache-then-network UI state (loading / content
     * / empty / stale / offline / error), carrying the freshness stamp + error kind. The combine mirrors
     * the web `WidgetShell` short-circuits: either feed first-loading ⇒ loading; an analytics hard error
     * ⇒ error; no vehicles AND no analytics ⇒ empty (the friendly "No fleet data available" surface).
     */
    val state: StateFlow<UiState<FleetStatsBarData>> =
        combine(
            refreshTrigger.flatMapLatest { source.vehicles() },
            refreshTrigger.flatMapLatest { source.fleetAnalytics() },
        ) { vehicles, analytics -> combineFleetStats(vehicles, analytics) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** The live display preferences (distance unit), re-derived as settings change (web `useUnits`). */
    val displayPrefs: StateFlow<FleetStatsBarDisplayPrefs> =
        source
            .settings()
            .map { resource -> FleetStatsBarDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = FleetStatsBarDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load of both feeds (the web `refetch()` affordance + error retry). */
    fun refresh() {
        logger.info("fleetStatsBar.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no fleet totals, so a diagnostics line can never leak vehicle counts or distance.
     * Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to FleetStatsBarRegistration.SLUG))
    }
}
