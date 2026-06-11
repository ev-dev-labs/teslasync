// The data port the Climate Status widget binds to — the native analogue of the web `useVehicles` +
// `useClimateLatest` hook pair the widget composes (web/src/api/hooks/useVehicles.ts; P1/S8 state-holder
// boundary). [vehicles] supplies the fallback active-vehicle id; [climate] is a cache-then-network
// [Resource] of one vehicle's latest climate snapshot (a raw `JsonElement`, exactly as the shared layer
// serves `/climate/latest`). The view never performs HTTP itself, and a test fake stands in for the
// whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ClimateStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatestatus

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [ClimateStatusWidgetViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the
 * default vehicle (web `vehicles?.[0]?.id`); [climate] is the cache-then-network latest-climate feed
 * (web `useClimateLatest`). No HTTP touches the view.
 */
interface ClimateStatusSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network latest climate snapshot (web `useClimateLatest`). */
    fun climate(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch,
 * which is what backs the widget's manual refresh/retry affordance (the web `useClimateLatest().refetch()`):
 * the view-model reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches the
 * view.
 */
fun VehiclesRepository.asClimateStatusSource(): ClimateStatusSource {
    val repo = this
    return object : ClimateStatusSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun climate(vehicleId: Long): Flow<Resource<JsonElement>> = repo.climateLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every
 * vehicle surface shares app-wide. Use this when a host wants the widget to fold into the same shared
 * collections as the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asClimateStatusSource(): ClimateStatusSource {
    val store = this
    return object : ClimateStatusSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun climate(vehicleId: Long): Flow<Resource<JsonElement>> = store.climateLatest(vehicleId)
    }
}

/**
 * Composes the fleet list with the active vehicle's climate snapshot into one cache-then-network
 * [Resource] stream — the native port of the web `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution
 * feeding `useClimateLatest(id)`. A positive [preferredVehicleId] short-circuits straight to its climate
 * feed (the web vehicle-list is not consulted when a prop id is supplied); otherwise the first enrolled
 * vehicle drives the feed, and when neither resolves the fleet resource is folded onto a no-snapshot
 * ([JsonNull]) value so the surface renders its loading / empty / error state honestly (web's disabled
 * `enabled: id > 0` query → `climateData` undefined → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun climateStatusResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    climateFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        climateFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleClimate())
                else -> climateFor(id)
            }
        }
    }
}

/** Folds a fleet-list [Resource] onto a no-snapshot climate value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleClimate(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
