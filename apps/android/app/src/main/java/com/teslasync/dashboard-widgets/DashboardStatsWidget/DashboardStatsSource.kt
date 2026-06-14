// The data seam the Dashboard Stats widget binds to, plus the S7 repository + S8 store adapters that drive
// it — the native analogue of the four web hooks the component composes: `useDashboardStats` (the
// vehicle-independent fleet summary), `useVehicles` (to resolve the default vehicle — web
// `vehicles?.[0]?.id`), `useVehicleStateMachine` (the `/vehicles/{id}/state` FSM read), and `useStateTimeline`
// (the `/vehicle-states/timeline` read, kept as a raw `{transitions}` envelope). See
// web/src/features/dashboard/widgets/DashboardStatsWidget.tsx + web/src/api/hooks/{useDashboard,useAdmin,
// useVehicles}.ts. The view never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a
// test fake) drives this seam, and the view-model folds each emission's cached/stale/error flags onto the
// render surface (ADR-013).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DashboardStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.dashboardstats

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.DashboardRepository
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.dashboard.DashboardStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The narrow seam the [DashboardStatsWidgetViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store/repository or the network — the Android analogue of the four hooks
 * the widget composes (P1/S8 state-holder boundary). [stats] is the primary, vehicle-independent fleet summary;
 * [vehicles] resolves only the default vehicle; [vehicleStateMachine] + [stateTimeline] are the per-vehicle
 * reads the widget gates on a resolved id (web `enabled: !!idStr`). No HTTP touches the view.
 */
interface DashboardStatsSource {
    /** The cache-then-network `GET /dashboard/stats` fleet summary (web `useDashboardStats`). */
    fun stats(): Flow<Resource<DashboardStats>>

    /** The cache-then-network `GET /vehicles` list (web `useVehicles`), used only to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` FSM read (web `useVehicleStateMachine`). */
    fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /vehicle-states/timeline?vehicle_id={id}` read (web `useStateTimeline`). */
    fun stateTimeline(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores also
 * wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the widget's
 * manual refresh / error-retry affordance (the web `refetch()`). The summary comes from [DashboardRepository],
 * the vehicle list from [VehiclesRepository], and both per-vehicle reads from [AdminRepository] (the timeline
 * uses the web default `days = 7`). No HTTP touches the view.
 */
fun dashboardStatsSource(
    dashboard: DashboardRepository,
    vehicles: VehiclesRepository,
    admin: AdminRepository,
): DashboardStatsSource =
    object : DashboardStatsSource {
        override fun stats(): Flow<Resource<DashboardStats>> = dashboard.stats()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>> = admin.vehicleStateMachine(vehicleId)

        override fun stateTimeline(vehicleId: String): Flow<Resource<JsonElement>> = admin.stateTimeline(vehicleId)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares. Use
 * this when a host wants the widget to fold into the same shared collections as the rest of the app; the live
 * values (incl. each store's background refresh) flow through unchanged. The admin store gates both per-vehicle
 * reads on a non-blank id (web `enabled: !!idStr`); the view-model only ever passes a resolved id. No HTTP
 * touches the view.
 */
fun dashboardStatsSource(
    dashboard: DashboardStore,
    vehicles: VehiclesStore,
    admin: AdminStore,
): DashboardStatsSource =
    object : DashboardStatsSource {
        override fun stats(): Flow<Resource<DashboardStats>> = dashboard.stats

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>> = admin.vehicleStateMachine(vehicleId)

        override fun stateTimeline(vehicleId: String): Flow<Resource<JsonElement>> = admin.stateTimeline(vehicleId)
    }
