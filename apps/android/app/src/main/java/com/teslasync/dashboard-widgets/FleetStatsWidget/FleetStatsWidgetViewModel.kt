// UI-thread-free state holder backing the Fleet Stats widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/FleetStatsWidget.tsx). It binds the shared data
// feeds (P1/S8) through [FleetStatsSource]: it projects the `useFleetAnalytics(30)` cache-then-network
// `/analytics/fleet` envelope onto the shared [UiState] surface ([state]), folds `useVehicles` + the two
// recent `useQuery` feeds into the supplementary bar counters + sparkline trends ([bar]), and derives the
// display preferences (distance unit) separately from the live `/settings` feed (web `useUnits`,
// [displayPrefs]). It exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [state] / [bar] / [displayPrefs] and calls
// [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FleetStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstats

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the default vehicle and projects the
 *   feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetStatsWidgetViewModel(
    private val source: FleetStatsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects every cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The fleet-analytics payload as cache-then-network UI state (loading / content / stale / offline /
     * error), carrying the freshness stamp + error kind — the feed that backs the web `WidgetShell`
     * freshness contract. Fleet Stats never hides its bar (the web `FleetStatsBar` always renders with
     * `?? 0` fallbacks), so a successful payload is always content (an all-zero fleet shows labeled
     * zeros, never a blank box) — hence `isEmpty = { false }`.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.fleetAnalytics() }
            .asUiState(isEmpty = { false })

    /**
     * The supplementary bar counters + sparkline trends, recomputed as the vehicles / recent-drives /
     * recent-charges feeds change. The recent feeds are scoped to the first enrolled vehicle (web
     * `vehicles?.[0]?.id`) and are only collected when one resolves (web `enabled: primaryId > 0`); with
     * no vehicle the trends stay empty while the count reflects the (possibly still-loading) list.
     */
    val bar: StateFlow<FleetStatsBarData> =
        refreshTrigger
            .flatMapLatest { barFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = FleetStatsBarData.EMPTY,
            )

    /** The live display preferences (distance unit), re-derived as settings change (web `useUnits`). */
    val displayPrefs: StateFlow<FleetStatsDisplayPrefs> =
        source
            .settings()
            .map { resource -> FleetStatsDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = FleetStatsDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("fleetStats.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no fleet / distance / energy payload, so a diagnostics line can never leak fleet
     * activity. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to FleetStatsRegistration.SLUG))
    }

    /**
     * The bar feed: resolves the first enrolled vehicle from the live list (web `vehicles?.[0]?.id`) and,
     * when one exists, combines its recent-drives + recent-charges feeds into the trends; with no vehicle
     * it emits the count-only bar (empty trends) without issuing a bogus `vehicle_id=0` recent request.
     */
    private fun barFeed(): Flow<FleetStatsBarData> =
        source.vehicles().flatMapLatest { vehiclesResource ->
            val vehicles = vehiclesResource.cached.orEmpty()
            val primaryId = vehicles.firstOrNull()?.id ?: 0L
            if (primaryId > 0L) {
                combine(source.recentDrives(primaryId), source.recentCharges(primaryId)) { drives, charges ->
                    barData(vehicles, drives.cached.orEmpty(), charges.cached.orEmpty())
                }
            } else {
                flowOf(barData(vehicles, emptyList(), emptyList()))
            }
        }

    /**
     * Folds the three feeds into the render-ready [FleetStatsBarData]. The two trends mirror the web
     * `recentDrives?.map(d => d.distance_m).reverse()` / `recentCharges?.map(s => s.total_energy_added_wh)
     * .reverse()`: the most-recent rows (the API returns them newest-first; we keep at most
     * [FleetStatsRegistration.RECENT_LIMIT]) mapped to their SI figure, then reversed so the sparkline
     * reads oldest → newest left-to-right.
     */
    private fun barData(
        vehicles: List<Vehicle>,
        drives: List<Drive>,
        charges: List<ChargingSession>,
    ): FleetStatsBarData =
        FleetStatsBarData(
            vehicleCount = vehicles.size,
            // web `vehicles.filter(v => v.state === 'online').length`: the generated /vehicles contract
            // ([Vehicle]) carries no live `state` field (live state is served only by the separate
            // /vehicles/{id}/state endpoint, which this widget — like the web — never queries), so the
            // filter resolves to 0 against the stateless payload. The total fleet size above is still exact.
            onlineCount = 0,
            // web passes `unreadAlerts={0}` — the FleetStatsBar receives a literal 0.
            unreadAlerts = 0,
            distanceTrend = drives.take(FleetStatsRegistration.RECENT_LIMIT).map { it.distanceM }.reversed(),
            energyTrend =
                charges
                    .take(FleetStatsRegistration.RECENT_LIMIT)
                    .map { it.totalEnergyAddedWh ?: 0.0 }
                    .reversed(),
        )
}
