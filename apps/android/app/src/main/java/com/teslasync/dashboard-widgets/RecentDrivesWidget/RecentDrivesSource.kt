// The data port the Recent Drives widget binds to — the native analogue of the two web hooks the
// component composes: `useVehicles` (to resolve the default vehicle when no explicit id is configured —
// web `vehicleId ?? vehicles?.[0]?.id ?? 0`) and the `useQuery(['drives', id, 'recent-5'])` list feed
// (`GET /drives?vehicle_id=`). The user's display units (web `useUnits`) are read at the Compose boundary
// from `LocalDataContainer.unitFormatter`, NOT through this seam — distance conversion is render-only
// (Phase-48 SI-canonical rule). See web/src/features/dashboard/widgets/RecentDrivesWidget.tsx +
// web/src/api/hooks/useVehicles.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to end
// (ADR-013): the view-model projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RecentDrivesWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentdrives

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * Streams the two cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`) and the
 * per-vehicle [drives] list (the rendered `GET /drives?vehicle_id=` feed). A narrow seam so the view-model
 * depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface RecentDrivesSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /drives?vehicle_id=` list feed for [vehicleId] (web `useQuery(['drives', …])`). */
    fun drives(vehicleId: String): Flow<Resource<List<Drive>>>
}

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun recentDrivesSource(
    vehicles: VehiclesStore,
    driving: DrivingStore,
): RecentDrivesSource =
    object : RecentDrivesSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> = driving.drives(vehicleId)
    }

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). No HTTP touches the view.
 */
fun recentDrivesSource(
    vehicles: VehiclesRepository,
    driving: DrivingRepository,
): RecentDrivesSource =
    object : RecentDrivesSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> = driving.drives(vehicleId)
    }

/**
 * Resolves the scoped vehicle id the web computes as `vehicleId ?? vehicles?.[0]?.id ?? 0`: an explicit
 * [explicit] id wins, otherwise the first enrolled vehicle, otherwise the `0` sentinel (no vehicle ⇒ the
 * web `enabled: id > 0` disabled query). Pure, so it is unit-tested off-device.
 */
internal fun resolveVehicleId(
    explicit: Long?,
    vehicles: List<Vehicle>?,
): Long = explicit ?: vehicles?.firstOrNull()?.id ?: NO_VEHICLE

/**
 * Composes the rendered drive feed from the [vehicles] list and the per-vehicle [drives] factory — the
 * native analogue of the web hook composition. An [explicitVehicleId] bypasses the list (web
 * `WidgetProps.vehicleId` precedence); otherwise the first enrolled vehicle is used. With no usable vehicle
 * the stream folds the vehicles feed onto the drive surface ([noVehicleResource]) so the disabled-query
 * case shows the empty state rather than spinning forever or issuing a bogus `vehicle_id=0` request — the
 * web `enabled: id > 0` gate. The view performs no HTTP; the shared layer owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun recentDrivesResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    drives: (Long) -> Flow<Resource<List<Drive>>>,
): Flow<Resource<List<Drive>>> =
    if (explicitVehicleId != null && explicitVehicleId > NO_VEHICLE) {
        drives(explicitVehicleId)
    } else {
        vehicles.flatMapLatest { resource ->
            val firstId = resource.cached?.firstOrNull()?.id
            if (firstId != null && firstId > NO_VEHICLE) drives(firstId) else flowOf(noVehicleResource(resource))
        }
    }

/**
 * Folds a vehicles feed that yields no usable vehicle onto the drive surface: a list still loading stays
 * loading; a hard list error becomes a drive error (retry); a resolved-but-empty list becomes an
 * empty-list success so the widget shows its friendly "No recent drives" empty state.
 */
internal fun noVehicleResource(resource: Resource<List<*>>): Resource<List<Drive>> =
    when (resource) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
        is Resource.Error ->
            Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)
        is Resource.Success -> Resource.Success(data = emptyList(), fetchedAt = resource.fetchedAt, stale = false)
    }

/** The web `?? 0` sentinel: no vehicle resolved ⇒ the query is disabled. */
private const val NO_VEHICLE = 0L
