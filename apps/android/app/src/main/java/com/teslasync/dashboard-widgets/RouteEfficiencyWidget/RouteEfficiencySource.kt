// The data port the Route Efficiency widget binds to — the native analogue of the two web hooks the
// component composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`) and
// `useRouteEfficiency` (the per-route feed — `GET /analytics/route-efficiency?vehicle_id={id}`). See
// web/src/features/dashboard/widgets/RouteEfficiencyWidget.tsx + web/src/api/hooks/useVehicles.ts +
// web/src/api/hooks/useDriving.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to
// end (ADR-013): the view-model projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RouteEfficiencyWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.routeefficiency

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`) and the
 * per-vehicle [routeEfficiency] document (the per-route feed `GET /analytics/route-efficiency?vehicle_id=`,
 * keyed by the string vehicle id exactly as the web `useRouteEfficiency(idStr)` does). A narrow seam so the
 * view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or
 * the network.
 */
interface RouteEfficiencySource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /analytics/route-efficiency?vehicle_id={id}` document feed (web `useRouteEfficiency`). */
    fun routeEfficiency(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting the route-efficiency feed performs a genuine cache-then-network re-fetch, which
 * is what backs the widget's manual refresh / error-retry affordance (the web `useRouteEfficiency().refetch()`).
 * The vehicles list comes from the [VehiclesRepository]; the route-efficiency document from the
 * [DrivingRepository]. No HTTP touches the view.
 */
fun routeEfficiencySource(
    vehicles: VehiclesRepository,
    driving: DrivingRepository,
): RouteEfficiencySource =
    object : RouteEfficiencySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun routeEfficiency(vehicleId: String): Flow<Resource<JsonElement>> = driving.routeEfficiency(vehicleId)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun routeEfficiencySource(
    vehicles: VehiclesStore,
    driving: DrivingStore,
): RouteEfficiencySource =
    object : RouteEfficiencySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun routeEfficiency(vehicleId: String): Flow<Resource<JsonElement>> = driving.routeEfficiency(vehicleId)
    }
