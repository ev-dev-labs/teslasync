// The data port the Fleet Stats Bar widget binds to — the native analogue of the three web hooks the
// component composes: `useVehicles` (the enrolled-vehicle list), `useFleetAnalytics(30)` (the rendered
// trailing-30-day `/analytics/fleet` feed), and `useUnits` (which reads the `/settings` document for the
// distance unit). See web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx,
// web/src/api/hooks/useVehicles.ts, and web/src/api/hooks/useAnalytics.ts. The view never performs HTTP;
// a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this seam. Cache-then
// network freshness is preserved end to end (ADR-013): the view-model projects each emission's
// cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FleetStatsBarWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstatsbar

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-[vehicles] list
 * (web `useVehicles`), the trailing-30-day [fleetAnalytics] deep feed (the rendered
 * `GET /analytics/fleet?days=30`, web `useFleetAnalytics(30)`), and the [settings] document
 * (web `useUnits`, for the distance unit). A narrow seam so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface FleetStatsBarSource {
    /** The cache-then-network `GET /vehicles` enrolled-list feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /analytics/fleet?days=30` feed (web `useFleetAnalytics(30)`). */
    fun fleetAnalytics(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting the feeds performs a genuine cache-then-network re-fetch, which is what backs
 * the widget's manual refresh / error-retry affordance (the web `refetch()`). The analytics window is
 * pinned to [FleetStatsBarRegistration.WINDOW_DAYS] (30), matching the web `useFleetAnalytics(30)` call.
 * No HTTP touches the view.
 */
fun fleetStatsBarSource(
    vehicles: VehiclesRepository,
    analytics: AnalyticsRepository,
    settings: SettingsRepository,
): FleetStatsBarSource =
    object : FleetStatsBarSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = analytics.fleetAnalytics(days = FleetStatsBarRegistration.WINDOW_DAYS)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface
 * shares. Use this when a host wants the widget to fold into the same shared collections as the rest of
 * the app; the live values (incl. each store's background refresh) flow through unchanged. The analytics
 * window is pinned to [FleetStatsBarRegistration.WINDOW_DAYS] (30). No HTTP touches the view.
 */
fun fleetStatsBarSource(
    vehicles: VehiclesStore,
    analytics: AnalyticsStore,
    settings: SettingsStore,
): FleetStatsBarSource =
    object : FleetStatsBarSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = analytics.fleetAnalytics(days = FleetStatsBarRegistration.WINDOW_DAYS)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
