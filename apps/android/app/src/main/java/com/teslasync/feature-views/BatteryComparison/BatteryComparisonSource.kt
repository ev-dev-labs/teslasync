// The data port the BatteryComparison feature view binds to — the native analogue of the web `useVehicles`
// list hook plus the per-vehicle `fetchVehicleState` query the component aggregates
// (web/src/api/hooks/useVehicles.ts; P1/S8 state-holder boundary). [vehicles] streams the enrolled fleet
// (web `vehicles` prop, sourced from `useVehicles`); [vehicleState] streams one vehicle's cache-then-network
// last-known state (web `fetchVehicleState(id)` inside the `['fleet-battery-states', …]` query). The view
// never performs HTTP itself, and a test fake stands in for the whole domain.
//
// The web component runs ONE `useQuery` whose `queryFn` does `Promise.all(vehicles.map(fetchVehicleState))`
// with a per-vehicle `try/catch` that yields `state: null` on failure, then filters to the resolved states.
// [batteryComparisonResource] is the native, cold cache-then-network analogue of that aggregation: it folds
// the fleet feed with one per-vehicle state feed each into a single [Resource] of render-ready rows so the
// view-model can project it onto the shared [io.teslasync.android.data.UiState] surface
// (loading / content / empty / stale / offline / error). Per-vehicle failures degrade gracefully to an
// excluded row (web parity); the only HARD error surfaced is a fleet-list failure with no cache, because
// without the fleet we cannot know which vehicles exist at all.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryComparison) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterycomparison

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * The single seam the [BatteryComparisonViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] streams the enrolled fleet (web
 * `useVehicles`); [vehicleState] streams one vehicle's cache-then-network last-known state (web
 * `fetchVehicleState`). No HTTP touches the view.
 */
interface BatteryComparisonSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`); the rows are one-per-vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network last-known state envelope (web `fetchVehicleState(id)`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch, which
 * backs the surface's refresh/retry affordance (the web query's 30s `refetchInterval` + `refetch()`). No HTTP
 * touches the view.
 */
fun VehiclesRepository.asBatteryComparisonSource(): BatteryComparisonSource {
    val repo = this
    return object : BatteryComparisonSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every vehicle
 * surface shares app-wide. Use this when a host wants the bars to fold into the same shared collections as the
 * rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asBatteryComparisonSource(): BatteryComparisonSource {
    val store = this
    return object : BatteryComparisonSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)
    }
}

/**
 * Composes the fleet feed with one per-vehicle state feed each into a single cache-then-network [Resource] of
 * render-ready rows — the native port of the web `useQuery` that maps `fetchVehicleState` over every vehicle
 * and filters to the resolved states. When the fleet list cannot be known (loading/error with no cache) the
 * fold is short-circuited to that no-fleet [Resource]; an empty fleet folds to an empty success (the web
 * disabled-query → no bars → empty surface); otherwise every vehicle's state stream is combined and
 * [foldBatteryReadings] reduces them to the rows + the honest lifecycle phase.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun batteryComparisonResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    stateFor: (Long) -> Flow<Resource<VehicleStateEnvelope>>,
): Flow<Resource<List<BatteryComparisonRow>>> =
    vehicles.flatMapLatest { vehiclesRes ->
        val list = vehiclesRes.cached
        when {
            list == null -> flowOf(vehiclesRes.toNoFleetRows())
            list.isEmpty() -> flowOf(vehiclesRes.toEmptyFleetRows())
            else ->
                combine(list.map { stateFor(it.id) }) { states ->
                    foldBatteryReadings(vehiclesRes, list, states.toList())
                }
        }
    }

/**
 * Reduce one combined snapshot of the fleet + every vehicle's state into a single [Resource] of render-ready
 * rows. [vehicles] is the (non-empty) cached fleet and [states] is the parallel per-vehicle state snapshot.
 *
 * The reduction mirrors the web aggregation + the ADR-013 cache-then-network contract:
 *  - rows are the projected bars (web `bars` — vehicles whose state resolved), so per-vehicle failures simply
 *    drop that vehicle (web's per-vehicle `catch` → `state: null` → filtered out);
 *  - with no rows yet and any source still first-loading → [Resource.Loading] with no cache (the skeleton);
 *  - with no rows and every source terminal → an empty [Resource.Success] (web `bars.length === 0`);
 *  - with rows and any source refreshing → [Resource.Loading] over the cached rows (refresh-in-flight);
 *  - with rows and any source failed → [Resource.Error] over the cached rows (offline / last-known);
 *  - otherwise a fresh [Resource.Success].
 */
internal fun foldBatteryReadings(
    vehiclesRes: Resource<List<Vehicle>>,
    vehicles: List<Vehicle>,
    states: List<Resource<VehicleStateEnvelope>>,
): Resource<List<BatteryComparisonRow>> {
    val readings =
        vehicles.mapIndexed { index, vehicle ->
            VehicleBatteryReading(
                vehicleId = vehicle.id,
                name = BatteryComparisonProjection.displayName(vehicle.displayName, vehicle.vin),
                state = states.getOrNull(index)?.cached?.state,
            )
        }
    val rows = BatteryComparisonProjection.project(readings)
    val fetchedAt = (states.mapNotNull(::fetchedAtOf) + listOfNotNull(fetchedAtOf(vehiclesRes))).maxOrNull()
    val stale = vehiclesRes.stale || states.any { it.stale }
    val anyLoading = vehiclesRes is Resource.Loading || states.any { it is Resource.Loading }
    val anyError = vehiclesRes is Resource.Error || states.any { it is Resource.Error }
    return when {
        rows.isEmpty() && anyLoading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
        rows.isEmpty() -> Resource.Success(data = emptyList(), fetchedAt = fetchedAt ?: 0L, stale = stale)
        anyLoading -> Resource.Loading(cached = rows, fetchedAt = fetchedAt, stale = stale)
        anyError -> Resource.Error(cached = rows, fetchedAt = fetchedAt, stale = true, error = firstError(vehiclesRes, states))
        else -> Resource.Success(data = rows, fetchedAt = fetchedAt ?: 0L, stale = stale)
    }
}

/**
 * Folds a fleet [Resource] with no cached list onto a no-rows [Resource], preserving the loading/error phase
 * so the surface shows its skeleton (fleet first-loading) or its hard error (fleet failed, nothing known). A
 * [Resource.Success] always carries a non-null list so this branch is unreachable for it, but it is mapped
 * exhaustively to an empty success for totality.
 */
private fun Resource<List<Vehicle>>.toNoFleetRows(): Resource<List<BatteryComparisonRow>> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
        is Resource.Success -> Resource.Success(data = emptyList(), fetchedAt = fetchedAt, stale = stale)
    }

/**
 * Folds an empty-fleet [Resource] onto an empty-rows [Resource], preserving the phase — the web disabled query
 * (`enabled: vehicles.length > 0`) → no bars → friendly empty surface (never a blank box).
 */
private fun Resource<List<Vehicle>>.toEmptyFleetRows(): Resource<List<BatteryComparisonRow>> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = emptyList(), fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(data = emptyList(), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = emptyList(), fetchedAt = fetchedAt, stale = stale, error = error)
    }

/** The [fetchedAt] stamp of any [Resource] variant, or `null` when none has loaded. */
private fun fetchedAtOf(res: Resource<*>): Long? =
    when (res) {
        is Resource.Loading -> res.fetchedAt
        is Resource.Success -> res.fetchedAt
        is Resource.Error -> res.fetchedAt
    }

/** The first failure across the fleet + per-vehicle states (fleet first), for the offline/error cause. */
private fun firstError(
    vehiclesRes: Resource<*>,
    states: List<Resource<*>>,
): Throwable =
    (vehiclesRes as? Resource.Error)?.error
        ?: states.firstNotNullOfOrNull { (it as? Resource.Error)?.error }
        ?: ApiError.Network()
