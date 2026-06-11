// The data port the Fleet Stats widget binds to — the native analogue of the five web reads the
// component composes: `useVehicles` (fleet size + the default vehicle that scopes the recent feeds),
// `useFleetAnalytics(30)` (the rendered trailing-30-day `/analytics/fleet` totals), the two raw
// `useQuery` recent feeds (`/drives?vehicle_id=&limit=5` + `/charging?vehicle_id=&limit=5`, folded into
// the mini sparklines), and `useUnits` (the `/settings` distance unit). See
// web/src/features/dashboard/widgets/FleetStatsWidget.tsx +
// web/src/features/dashboard/components/FleetStatsBar.tsx. The view never performs HTTP; a concrete
// adapter over the shared S7/S8 data layer (or a test fake) drives this seam. Cache-then-network
// freshness is preserved end to end (ADR-013): the view-model projects each emission's cached/stale/
// error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FleetStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstats

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.charging.ChargingStore
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the five cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (web
 * `useVehicles` — fleet size + the first vehicle that scopes the recent feeds), the trailing-30-day
 * [fleetAnalytics] totals (web `useFleetAnalytics(30)`), the [recentDrives] / [recentCharges] lists for a
 * vehicle (web's two `useQuery(['drives'|'charging', id, 'recent-5'])` reads, folded into the sparklines),
 * and the [settings] document (web `useUnits`, for the distance unit). A narrow seam so the view-model
 * depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the
 * network.
 */
interface FleetStatsSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /analytics/fleet?days=30` totals feed (web `useFleetAnalytics(30)`). */
    fun fleetAnalytics(): Flow<Resource<JsonElement>>

    /** The cache-then-network recent-drives feed for [vehicleId] (web `useQuery(['drives', id, 'recent-5'])`). */
    fun recentDrives(vehicleId: Long): Flow<Resource<List<Drive>>>

    /** The cache-then-network recent-charges feed for [vehicleId] (web `useQuery(['charging', id, 'recent-5'])`). */
    fun recentCharges(vehicleId: Long): Flow<Resource<List<ChargingSession>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs
 * the widget's manual refresh / error-retry affordance (the web `refetch()`). The analytics window is
 * pinned to [FleetStatsRegistration.WINDOW_DAYS] (30) and the charging page to
 * [FleetStatsRegistration.RECENT_LIMIT] (5), matching the web calls. The recent drives list is bounded at
 * the projection (the web `/drives?…&limit=5`), since the repository's `drives` read carries no limit
 * param. No HTTP touches the view.
 */
fun fleetStatsSource(
    vehicles: VehiclesRepository,
    analytics: AnalyticsRepository,
    driving: DrivingRepository,
    charging: ChargingRepository,
    settings: SettingsRepository,
): FleetStatsSource =
    object : FleetStatsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = analytics.fleetAnalytics(days = FleetStatsRegistration.WINDOW_DAYS)

        override fun recentDrives(vehicleId: Long): Flow<Resource<List<Drive>>> = driving.drives(vehicleId.toString())

        override fun recentCharges(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
            charging.sessionsPaginated(vehicleId, limit = FleetStatsRegistration.RECENT_LIMIT, offset = 0)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. The analytics window is
 * pinned to [FleetStatsRegistration.WINDOW_DAYS] (30) and the charging page to
 * [FleetStatsRegistration.RECENT_LIMIT] (5). No HTTP touches the view.
 */
fun fleetStatsSource(
    vehicles: VehiclesStore,
    analytics: AnalyticsStore,
    driving: DrivingStore,
    charging: ChargingStore,
    settings: SettingsStore,
): FleetStatsSource =
    object : FleetStatsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = analytics.fleetAnalytics(days = FleetStatsRegistration.WINDOW_DAYS)

        override fun recentDrives(vehicleId: Long): Flow<Resource<List<Drive>>> = driving.drives(vehicleId.toString())

        override fun recentCharges(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
            charging.sessionsPaginated(vehicleId, limit = FleetStatsRegistration.RECENT_LIMIT, offset = 0)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
