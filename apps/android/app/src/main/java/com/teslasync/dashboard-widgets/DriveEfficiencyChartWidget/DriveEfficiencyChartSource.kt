// The data port the [DriveEfficiencyChartWidgetViewModel] binds to (P1/S8 state-holder seam). It
// yields the cache-then-network sequence of a vehicle's recent drives for `GET /drives/?vehicle_id=`
// — the native analogue of the web `useVehicles` + `useQuery('/drives?vehicle_id=&limit=60')` hook
// composition (vehicle resolution included). The view never performs HTTP itself; the
// [DrivingStoreDriveEfficiencyChartSource] (or a test fake) drives this.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveEfficiencyChartWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.driveefficiencychart

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * Streams the cache-then-network drive list the widget projects into its efficiency chart. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on
 * a concrete store or the network.
 */
fun interface DriveEfficiencyChartSource {
    /** The cache-then-network drives feed (cached rows first, then the refreshed rows). */
    fun stream(): Flow<Resource<List<Drive>>>
}

/**
 * The shared-state-holder-backed [DriveEfficiencyChartSource]. It resolves the scoped vehicle (the
 * native analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins,
 * otherwise the app-wide active vehicle from [activeVehicleId]), then maps the shared
 * [DrivingStore.drives] cache-then-network feed (web `useDrives` / `request('/drives?vehicle_id=')`).
 * With no vehicle — or a non-positive id, mirroring the web `enabled: id > 0` gate — the stream emits
 * a resolved-empty success so the surface shows the "No efficiency data yet" empty state. The web
 * `limit=60` and the trailing-30-day filter are applied at the projection layer; the shared store owns
 * the fetch. No HTTP touches the view — the [DrivingStore] (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DrivingStoreDriveEfficiencyChartSource(
    private val drivingStore: DrivingStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : DriveEfficiencyChartSource {
    override fun stream(): Flow<Resource<List<Drive>>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId ?: active) {
                null -> resolvedEmpty()
                else -> if (vehicleId > 0) drivingStore.drives(vehicleId.toString()) else resolvedEmpty()
            }
        }

    private fun resolvedEmpty(): Flow<Resource<List<Drive>>> =
        flowOf(Resource.Success(data = emptyList(), fetchedAt = NO_FETCH, stale = false))

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
