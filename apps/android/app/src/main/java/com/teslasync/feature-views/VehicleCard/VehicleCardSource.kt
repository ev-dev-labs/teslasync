// The data port the VehicleCard feature view binds to — the native analogue of the web `useVehicleState(id)`
// hook the component runs for its own `vehicle` prop (web/src/api/hooks/useVehicles.ts; P1/S8 state-holder
// boundary). [vehicleState] streams one vehicle's cache-then-network last-known state envelope (web
// `useVehicleState(vehicle.id)`). The view never performs HTTP itself, and a test fake stands in for the whole
// domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecard

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [VehicleCardViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store/repository or the network. [vehicleState] streams one vehicle's
 * cache-then-network last-known state envelope (web `useVehicleState(vehicle.id)`). No HTTP touches the view.
 */
interface VehicleCardSource {
    /** Stream one vehicle's cache-then-network last-known state envelope (web `useVehicleState(id)`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holder every vehicle
 * surface shares app-wide, so a card folds into the same shared `vehicleState(id)` collection as the rest of
 * the app (the live values flow through unchanged). This is the default a host uses. No HTTP touches the view.
 */
fun VehiclesStore.asVehicleCardSource(): VehicleCardSource {
    val store = this
    return object : VehicleCardSource {
        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feed the S8
 * [VehiclesStore] also wraps. Re-collecting it performs a genuine cache-then-network re-fetch, which backs the
 * card's retry / stale auto-refresh affordance (the web `useVehicleState().refetch()`). No HTTP touches the view.
 */
fun VehiclesRepository.asVehicleCardSource(): VehicleCardSource {
    val repo = this
    return object : VehicleCardSource {
        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)
    }
}
