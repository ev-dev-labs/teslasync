// The data port the [RecentDrivesListWidgetViewModel] binds to (P1/S8 state-holder seam). It yields the
// cache-then-network sequence of a vehicle's recent drives for `GET /drives/?vehicle_id=` — the native
// analogue of the web `useVehicles` + `useQuery('/drives?vehicle_id=&limit=driveLimit')` hook
// composition (vehicle resolution included). The view never performs HTTP itself; the
// [DrivingStoreRecentDrivesListSource] (or a test fake) drives this. The web `limit=driveLimit` slice is
// applied at the projection layer ([RecentDrivesListProjection.project]); the shared store owns the
// unbounded fetch and its cache-then-network freshness (ADR-013).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RecentDrivesListWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentdriveslist

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * Streams the cache-then-network drive list the widget projects into its recent-drives rows. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store or the network.
 */
fun interface RecentDrivesListSource {
    /** The cache-then-network drives feed (cached rows first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<List<Drive>>>
}

/**
 * The shared-state-holder-backed [RecentDrivesListSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId], which self-heals to the first enrolled vehicle via
 * `SelectedVehicleStore`), then maps the shared [DrivingStore.drives] cache-then-network feed (web
 * `useDrives` / `request('/drives?vehicle_id=')`). With no vehicle — or a non-positive id, mirroring the
 * web `enabled: id > 0` gate — the stream emits a resolved-empty success so the surface shows the "No
 * recent drives recorded" empty state. No HTTP touches the view — the [DrivingStore] (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DrivingStoreRecentDrivesListSource(
    private val drivingStore: DrivingStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : RecentDrivesListSource {
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
