// The data port the TirePressureSection feature view binds to — the native analogue of the latest-tire-pressure
// feed that backs the web `TirePressureSnapshot` prop (web/src/api/hooks/useVehicles.ts `useLatestTirePressure`;
// P1/S8 state-holder boundary). The web component itself is presentational — a host page (VehicleDetailPage)
// resolves the active vehicle and passes its `useLatestTirePressure(id)` snapshot down as a prop — so this port
// mirrors that host wiring: [vehicles] resolves the fallback active vehicle (web `vehicles?.[0]?.id`) and
// [tirePressure] is the cache-then-network [Resource] of one vehicle's latest tire-pressure snapshot (a raw
// `JsonElement`, exactly as the shared layer serves `/tire-pressure/latest`). The view never performs HTTP
// itself, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TirePressureSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressuresection

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
 * The single seam the [TirePressureSectionViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle (web
 * `vehicles?.[0]?.id`); [tirePressure] is the cache-then-network latest-tire-pressure feed (web
 * `useLatestTirePressure`). No HTTP touches the view.
 */
interface TirePressureSectionSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network latest tire-pressure snapshot (web `useLatestTirePressure`). */
    fun tirePressure(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch, which
 * backs the section's refresh/retry affordance (the web page's `useLatestTirePressure().refetch()`). No HTTP
 * touches the view.
 */
fun VehiclesRepository.asTirePressureSectionSource(): TirePressureSectionSource {
    val repo = this
    return object : TirePressureSectionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun tirePressure(vehicleId: Long): Flow<Resource<JsonElement>> = repo.latestTirePressure(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every vehicle
 * surface shares app-wide. Use this when a host wants the section to fold into the same shared feeds as the rest
 * of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asTirePressureSectionSource(): TirePressureSectionSource {
    val store = this
    return object : TirePressureSectionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun tirePressure(vehicleId: Long): Flow<Resource<JsonElement>> = store.latestTirePressure(vehicleId)
    }
}

/**
 * Composes the fleet list with the active vehicle's tire-pressure snapshot into one cache-then-network
 * [Resource] stream — the native port of the host's `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution
 * feeding `useLatestTirePressure(id)`. A positive [preferredVehicleId] short-circuits straight to its
 * tire-pressure feed (the vehicle list is not consulted when a prop id is supplied); otherwise the first
 * enrolled vehicle drives the feed, and when neither resolves the fleet resource is folded onto a no-snapshot
 * ([JsonNull]) value so the surface renders its loading / empty / error state honestly (the disabled
 * `enabled: id > 0` query → undefined snapshot → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun tirePressureSectionResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    tirePressureFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        tirePressureFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleTirePressure())
                else -> tirePressureFor(id)
            }
        }
    }
}

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
internal fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

/** Folds a fleet-list [Resource] onto a no-snapshot tire-pressure value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleTirePressure(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
