// The data port the State Timeline widget binds to — the native analogue of the three web hooks the
// component composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`),
// `useStateSummary` (the `/vehicle-states/summary?vehicle_id=` `[{state,totalMin,count}]` feed), and
// `useTimeline` (the `/vehicle-states/timeline?vehicle_id=` feed, unwrapped to its `transitions` array).
// See web/src/features/dashboard/widgets/StateTimelineWidget.tsx + web/src/api/hooks/useAnalytics.ts +
// web/src/api/hooks/useVehicles.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to end
// (ADR-013): the view-model folds each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/StateTimelineWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.statetimeline

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the
 * per-vehicle [summary] array (the rendered `GET /vehicle-states/summary?vehicle_id=` `{state,totalMin,
 * count}` feed), and the per-vehicle [timeline] array (the `GET /vehicle-states/timeline?vehicle_id=` feed,
 * unwrapped to its `transitions`). A narrow seam so the view-model depends on an abstraction (real adapter
 * ↔ test fake), never on a concrete store/repository or the network.
 */
interface StateTimelineSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicle-states/summary?vehicle_id={id}` feed (web `useStateSummary`). */
    fun summary(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /vehicle-states/timeline?vehicle_id={id}` feed (web `useTimeline`). */
    fun timeline(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). The vehicles list comes from the
 * [VehiclesRepository]; both state feeds come from the [AnalyticsRepository]. No HTTP touches the view.
 */
fun stateTimelineSource(
    vehicles: VehiclesRepository,
    analytics: AnalyticsRepository,
): StateTimelineSource =
    object : StateTimelineSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun summary(vehicleId: String): Flow<Resource<JsonElement>> = analytics.stateSummary(vehicleId)

        override fun timeline(vehicleId: String): Flow<Resource<JsonElement>> = analytics.timeline(vehicleId)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. The store gates both state
 * feeds on a non-blank id (web `enabled: !!entityId`); the view-model only ever passes a resolved id. No
 * HTTP touches the view.
 */
fun stateTimelineSource(
    vehicles: VehiclesStore,
    analytics: AnalyticsStore,
): StateTimelineSource =
    object : StateTimelineSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun summary(vehicleId: String): Flow<Resource<JsonElement>> = analytics.stateSummary(vehicleId)

        override fun timeline(vehicleId: String): Flow<Resource<JsonElement>> = analytics.timeline(vehicleId)
    }
