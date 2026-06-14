// The data port the Weather at Car widget binds to — the native analogue of the two web hooks the
// component composes: `useVehicles` (to resolve the default vehicle) and `useVehicleState` (the rendered
// feed). See web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx + web/src/api/hooks/useVehicles.ts.
// The view never performs HTTP; a concrete adapter over the shared Vehicles data layer (or a test fake)
// drives this seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects
// each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WeatherAtCarWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.weatheratcar

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * Streams the two cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`) and a
 * per-vehicle [vehicleState] envelope (the rendered `GET /vehicles/{id}/state` feed). A narrow two-method
 * seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
 * store/repository or the network.
 */
interface WeatherAtCarSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` envelope feed for [vehicleId] (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>
}

/**
 * Binds the widget to the shared **S7** [VehiclesRepository] — the cold cache-then-network `Flow`s the S8
 * [VehiclesStore] also wraps. Re-collecting either feed performs a genuine cache-then-network re-fetch,
 * which is what backs the widget's manual refresh / error-retry affordance (the web
 * `useVehicleState().refetch()`). No HTTP touches the view.
 */
fun VehiclesRepository.asWeatherAtCarSource(): WeatherAtCarSource {
    val repo = this
    return object : WeatherAtCarSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)
    }
}

/**
 * Binds the widget to the shared **S8** [VehiclesStore] — the memoized, multi-observer feeds every
 * Vehicles surface shares. Use this when a host wants the widget to fold into the same shared collections
 * as the rest of the app; the live values (incl. the store's background refresh) flow through unchanged.
 * No HTTP touches the view.
 */
fun VehiclesStore.asWeatherAtCarSource(): WeatherAtCarSource {
    val store = this
    return object : WeatherAtCarSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)
    }
}
