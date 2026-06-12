// The data port the GForcePanel feature view binds to — the native analogue of the web
// `useDriveDynamicsLatest(vehicleId)` hook the component calls directly
// (web/src/api/hooks/useVehicles.ts; P1/S8 state-holder boundary). [driveDynamics] is a cache-then-network
// [Resource] of one vehicle's latest g-force snapshot (a raw `JsonElement`, exactly as the shared layer serves
// `/drive-dynamics/latest`). The web component receives `vehicleId` as a prop and does NOT resolve the fleet
// list itself (its query is simply `enabled: vehicleId > 0`), so this port carries only the one feed the
// component reads; the view never performs HTTP, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GForcePanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.gforcepanel

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [GForcePanelViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store/repository or the network. [driveDynamics] is the cache-then-network
 * latest-drive-dynamics feed the web component polls (web `useDriveDynamicsLatest`). No HTTP touches the view.
 */
interface GForcePanelSource {
    /** Stream one vehicle's cache-then-network latest g-force snapshot (web `useDriveDynamicsLatest`). */
    fun driveDynamics(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feed the S8
 * [VehiclesStore] also wraps. Re-collecting it performs a genuine cache-then-network re-fetch, which backs the
 * surface's refresh/retry affordance (the web page's 5s realtime poll + `refetch()`). No HTTP touches the view.
 */
fun VehiclesRepository.asGForcePanelSource(): GForcePanelSource {
    val repo = this
    return object : GForcePanelSource {
        override fun driveDynamics(vehicleId: Long): Flow<Resource<JsonElement>> = repo.driveDynamicsLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every vehicle
 * surface shares app-wide. Use this when a host wants the panel to fold into the same shared feeds as the rest
 * of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asGForcePanelSource(): GForcePanelSource {
    val store = this
    return object : GForcePanelSource {
        override fun driveDynamics(vehicleId: Long): Flow<Resource<JsonElement>> = store.driveDynamicsLatest(vehicleId)
    }
}

/**
 * Resolves the panel's cache-then-network [Resource] stream from the host-selected [preferredVehicleId] — the
 * native port of the web `useDriveDynamicsLatest(vehicleId ?? 0, …)` call whose query is `enabled: vehicleId >
 * 0`. A positive id streams that vehicle's drive-dynamics feed; a `null`/non-positive id (the web's disabled
 * query → `data` undefined) folds to a no-snapshot [JsonNull] success so the surface renders its friendly empty
 * state honestly rather than spinning forever.
 */
internal fun gForceResource(
    preferredVehicleId: Long?,
    driveDynamicsFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        driveDynamicsFor(preferred)
    } else {
        flowOf(Resource.Success(JsonNull, fetchedAt = NO_VEHICLE_STAMP, stale = false))
    }
}

/** Epoch stamp for the synthetic no-vehicle success — `0` so the surface treats it as "no fetch has run". */
private const val NO_VEHICLE_STAMP: Long = 0L
