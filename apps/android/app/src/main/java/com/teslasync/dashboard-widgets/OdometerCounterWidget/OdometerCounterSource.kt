// The data port the Odometer Counter widget binds to — the native analogue of the three web hooks the
// component composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`),
// `useVehicleState` (the odometer source — `GET /vehicles/{id}/state`), and `useDrivingStats` (the
// "Total Driven" source — `GET /drives/stats?vehicle_id=`). See
// web/src/features/dashboard/widgets/OdometerCounterWidget.tsx + web/src/api/hooks/useVehicles.ts +
// web/src/api/hooks/useDriving.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to end
// (ADR-013): the view-model projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/OdometerCounterWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.odometercounter

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the
 * per-vehicle [vehicleState] envelope (the odometer feed `GET /vehicles/{id}/state`, web `useVehicleState`),
 * and the per-vehicle [drivingStats] document (the "Total Driven" feed `GET /drives/stats?vehicle_id=`,
 * keyed by the string vehicle id exactly as the web `useDrivingStats(idStr)` does). A narrow seam so the
 * view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or
 * the network.
 */
interface OdometerCounterSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` envelope feed for [vehicleId] (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The cache-then-network `GET /drives/stats?vehicle_id={id}` document feed (web `useDrivingStats`). */
    fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `useVehicleState().refetch()`). The vehicles
 * list and the vehicle-state envelope come from the [VehiclesRepository]; the driving-stats document from
 * the [DrivingRepository]. No HTTP touches the view.
 */
fun odometerCounterSource(
    vehicles: VehiclesRepository,
    driving: DrivingRepository,
): OdometerCounterSource =
    object : OdometerCounterSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = vehicles.vehicleState(vehicleId)

        override fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> = driving.drivingStats(vehicleId)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun odometerCounterSource(
    vehicles: VehiclesStore,
    driving: DrivingStore,
): OdometerCounterSource =
    object : OdometerCounterSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = vehicles.vehicleState(vehicleId)

        override fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> = driving.drivingStats(vehicleId)
    }
