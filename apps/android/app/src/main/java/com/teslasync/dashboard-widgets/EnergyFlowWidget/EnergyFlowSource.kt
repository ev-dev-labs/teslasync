// The data port the Energy Flow widget binds to — the native analogue of the web `useVehicles` +
// `useVehicleState` hook pair the widget composes (web/src/api/hooks/useVehicles.ts; P1/S8 state-holder
// boundary). [vehicles] supplies the fallback active-vehicle id; [vehicleState] is a cache-then-network
// [Resource] of one vehicle's last-known state (a [VehicleStateEnvelope], exactly as the shared layer
// serves `/vehicles/{id}/state`). The view never performs HTTP itself, and a test fake stands in for the
// whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergyFlowWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energyflow

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * The single seam the [EnergyFlowWidgetViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the default
 * vehicle (web `vehicles?.[0]?.id`); [vehicleState] is the cache-then-network last-known-state feed
 * (web `useVehicleState`). No HTTP touches the view.
 */
interface EnergyFlowSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network last-known state (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch,
 * which is what backs the widget's manual refresh/retry affordance (the web `useVehicleState().refetch()`):
 * the view-model reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches
 * the view.
 */
fun VehiclesRepository.asEnergyFlowSource(): EnergyFlowSource {
    val repo = this
    return object : EnergyFlowSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every
 * vehicle surface shares app-wide. Use this when a host wants the widget to fold into the same shared
 * collections as the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asEnergyFlowSource(): EnergyFlowSource {
    val store = this
    return object : EnergyFlowSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)
    }
}

/**
 * Composes the fleet list with the active vehicle's state into one cache-then-network [Resource] stream
 * — the native port of the web `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution feeding
 * `useVehicleState(id)`. A positive [preferredVehicleId] short-circuits straight to its state feed (the
 * web vehicle-list is not consulted when a prop id is supplied); otherwise the first enrolled vehicle
 * drives the feed, and when neither resolves the fleet resource is folded onto a no-state
 * ([VehicleStateEnvelope] with `state = null`) value so the surface renders its loading / empty / error
 * state honestly (web's disabled `enabled: id > 0` query → `stateData` undefined → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun energyFlowResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    stateFor: (Long) -> Flow<Resource<VehicleStateEnvelope>>,
): Flow<Resource<VehicleStateEnvelope>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        stateFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleState())
                else -> stateFor(id)
            }
        }
    }
}

/** Folds a fleet-list [Resource] onto a no-state envelope, preserving loading/empty/error + freshness. */
private fun Resource<List<Vehicle>>.toNoVehicleState(): Resource<VehicleStateEnvelope> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(VehicleStateEnvelope(state = null, live = false), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
