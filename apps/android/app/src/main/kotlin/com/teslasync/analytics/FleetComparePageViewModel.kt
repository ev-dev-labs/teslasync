// The state holder backing the FleetComparePage analytics surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hook composition (web/src/features/analytics/pages/FleetComparePage.tsx).
// It owns the page's local interaction state (the two selected vehicles + the disambiguation-banner visibility) as
// one immutable [FleetCompareInteraction] snapshot, auto-selects the first two enrolled vehicles (web `useEffect`
// fallback), and projects the six cache-then-network reads (`useVehicles`, two `useVehicleState`, two
// `useDrivingStats`, two `useCostBreakdown`, two `useMonthlyMileage`, `useUnits`) onto the shared lifecycle-aware
// [UiState] surface via [BaseFeedViewModel.asUiState]. Each per-vehicle feed re-collects whenever its selected
// vehicle changes or the refresh trigger bumps; a feed for a still-unselected slot parks on a loading sentinel.
// All derivation logic lives in the framework-free model (FleetComparePageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.fleetcompare

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (the shared Vehicles + Analytics + Driving + Settings holders in production, a
 *   fake in tests); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetComparePageViewModel(
    private val source: FleetCompareSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(FleetCompareInteraction())
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState` group: vehicle A + vehicle B + banner visibility). */
    val interaction: StateFlow<FleetCompareInteraction> = mutableInteraction.asStateFlow()

    /**
     * The fleet list as cache-then-network UI state (web `useVehicles`). Drives the two selectors, the
     * single-vehicle guard, and — via [autoSelectFrom] — the first-two auto-select.
     */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Vehicle A's live-state feed (web `useVehicleState(numIdA)`); parks on loading until A is selected. */
    val stateA: StateFlow<UiState<VehicleStateEnvelope>> =
        perVehicleState { it.numericIdA }

    /** Vehicle B's live-state feed (web `useVehicleState(numIdB)`). */
    val stateB: StateFlow<UiState<VehicleStateEnvelope>> =
        perVehicleState { it.numericIdB }

    /** Vehicle A's lifetime driving-stats feed (web `useDrivingStats(vehicleIdA)`). */
    val drivingStatsA: StateFlow<UiState<JsonElement>> =
        perVehicleJson({ it.vehicleIdA }, source::drivingStats)

    /** Vehicle B's lifetime driving-stats feed (web `useDrivingStats(vehicleIdB)`). */
    val drivingStatsB: StateFlow<UiState<JsonElement>> =
        perVehicleJson({ it.vehicleIdB }, source::drivingStats)

    /** Vehicle A's cost-breakdown feed (web `useCostBreakdown(vehicleIdA)`). */
    val costA: StateFlow<UiState<JsonElement>> =
        perVehicleJson({ it.vehicleIdA }, source::costBreakdown)

    /** Vehicle B's cost-breakdown feed (web `useCostBreakdown(vehicleIdB)`). */
    val costB: StateFlow<UiState<JsonElement>> =
        perVehicleJson({ it.vehicleIdB }, source::costBreakdown)

    /** Vehicle A's monthly-mileage feed for the overlaid charts (web `useMonthlyMileage(vehicleIdA)`). */
    val monthlyA: StateFlow<UiState<JsonElement>> =
        perVehicleJson({ it.vehicleIdA }, source::monthlyMileage)

    /** Vehicle B's monthly-mileage feed for the overlaid charts (web `useMonthlyMileage(vehicleIdB)`). */
    val monthlyB: StateFlow<UiState<JsonElement>> =
        perVehicleJson({ it.vehicleIdB }, source::monthlyMileage)

    /** The live display preferences (units + currency), re-derived as settings change (web `useUnits`). */
    val displayPrefs: StateFlow<FleetCompareDisplayPrefs> =
        source
            .settings()
            .map { resource -> FleetCompareDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = FleetCompareDisplayPrefs.METRIC_DEFAULT,
            )

    init {
        // Mirror the web `useEffect` auto-select: when the fleet resolves, default the two unselected slots to
        // the first two enrolled vehicles (or the first one for a single-vehicle account).
        launch {
            source.vehicles().collect { resource ->
                resource.cached?.let(::autoSelectFrom)
            }
        }
    }

    // ── Interaction setters (web `setVehicleIdA` / `setVehicleIdB` / `dismissBanner`) ─────────────────────────────

    /** Select vehicle A (web `setVehicleIdA`). */
    fun setVehicleA(id: String): Unit = mutableInteraction.update { it.copy(vehicleIdA = id) }

    /** Select vehicle B (web `setVehicleIdB`). */
    fun setVehicleB(id: String): Unit = mutableInteraction.update { it.copy(vehicleIdB = id) }

    /** Dismiss the disambiguation banner for this session (web `dismissBanner`). */
    fun dismissBanner(): Unit = mutableInteraction.update { it.copy(bannerVisible = false) }

    // ── Refresh / retry (web query `refetch` + the per-panel error retry) ─────────────────────────────────────────

    /** Re-collect every cache-then-network feed — the web `refetch` / panel error-retry affordance. */
    fun refresh() {
        logger.info("fleetCompare.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the panels' hard-error surfaces. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordFleetComparePageOpened(logger)
    }

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────────────────

    /** Fills the two unselected slots from [list] (web `vehicles?.[0]?.id` / `[1]?.id` fallback). Idempotent. */
    private fun autoSelectFrom(list: List<Vehicle>) {
        mutableInteraction.update { current ->
            var a = current.vehicleIdA
            var b = current.vehicleIdB
            when {
                list.size >= 2 -> {
                    if (a.isBlank()) a = list[0].id.toString()
                    if (b.isBlank()) b = list[1].id.toString()
                }
                list.size == 1 && a.isBlank() -> a = list[0].id.toString()
            }
            if (a == current.vehicleIdA && b == current.vehicleIdB) current else current.copy(vehicleIdA = a, vehicleIdB = b)
        }
    }

    /**
     * Builds a per-vehicle live-state feed gated on the selected numeric id (web `useVehicleState` +
     * `enabled: id > 0`): it re-collects when the selected vehicle changes or the refresh trigger bumps, and parks
     * on a loading sentinel while the slot is unselected (id ≤ 0) so nothing bogus is fetched.
     */
    private fun perVehicleState(idOf: (FleetCompareInteraction) -> Long): StateFlow<UiState<VehicleStateEnvelope>> =
        combine(mutableInteraction.map(idOf).distinctUntilChanged(), refreshTrigger) { id, _ -> id }
            .flatMapLatest { id -> if (id > 0L) source.vehicleState(id) else flowOf(loadingResource<VehicleStateEnvelope>()) }
            .asUiState(isEmpty = { it.state == null })

    /**
     * Builds a per-vehicle raw-JSON feed (driving stats / cost / monthly) gated on the selected string id (web
     * `enabled: !!vehicleId`). Re-collects on selection change or refresh; parks on loading while unselected.
     */
    private fun perVehicleJson(
        idOf: (FleetCompareInteraction) -> String,
        feed: (String) -> Flow<Resource<JsonElement>>,
    ): StateFlow<UiState<JsonElement>> =
        combine(mutableInteraction.map(idOf).distinctUntilChanged(), refreshTrigger) { id, _ -> id }
            .flatMapLatest { id -> if (id.isNotBlank()) feed(id) else flowOf(loadingResource<JsonElement>()) }
            .asUiState(isEmpty = { false })

    private companion object {
        /** The "nothing selected yet" sentinel — a cold loading emission carrying no cached value. */
        fun <T> loadingResource(): Resource<T> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
