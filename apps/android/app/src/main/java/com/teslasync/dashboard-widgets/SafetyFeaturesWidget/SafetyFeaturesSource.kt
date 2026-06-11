// The data port the Safety Features widget binds to — the native analogue of the web `useVehicles` +
// `useSafety` hook pair the widget composes (web/src/api/hooks/useVehicles.ts,
// web/src/api/hooks/useVehicleSystems.ts; P1/S8 state-holder boundary). [vehicles] supplies the fallback
// active-vehicle id; [safety] is a cache-then-network [Resource] of one vehicle's latest safety snapshot
// (a raw `JsonElement`, exactly as the shared layer serves `/safety/latest`). The view never performs
// HTTP itself, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SafetyFeaturesWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.safetyfeatures

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSystemsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import io.teslasync.shared.core.presentation.vehiclesystems.VehicleSystemsStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [SafetyFeaturesWidgetViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the
 * default vehicle (web `vehicles?.[0]?.id`); [safety] is the cache-then-network latest-safety feed (web
 * `useSafety`). No HTTP touches the view.
 */
interface SafetyFeaturesSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network latest safety snapshot (web `useSafety`). */
    fun safety(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Composes the fleet list with the active vehicle's safety snapshot into one cache-then-network
 * [Resource] stream — the native port of the web `vid = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution
 * feeding `useSafety(vid > 0 ? String(vid) : '')`. A positive [preferredVehicleId] short-circuits straight
 * to its safety feed (the web vehicle-list is not consulted when a prop id is supplied); otherwise the
 * first enrolled vehicle drives the feed, and when neither resolves the fleet resource is folded onto a
 * no-snapshot ([JsonNull]) value so the surface renders its loading / empty / error state honestly (web's
 * disabled `enabled: !!vehicleId` query → `data` undefined → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun safetyFeaturesResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    safetyFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        safetyFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleSafety())
                else -> safetyFor(id)
            }
        }
    }
}

/** Folds a fleet-list [Resource] onto a no-snapshot safety value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleSafety(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }

/**
 * The shared **S8** state-holder-backed [SafetyFeaturesSource]. Resolves the scoped vehicle from the
 * shared [VehiclesStore] enrolled-vehicle list (web `vehicles?.[0]?.id`, overridable by the view-model's
 * vehicle id) and maps the shared [VehicleSystemsStore.safety] cache-then-network feed (web `useSafety`).
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app.
 * No HTTP touches the view — the stores (S7/S8) own it.
 */
class StoreSafetyFeaturesSource(
    private val vehiclesStore: VehiclesStore,
    private val vehicleSystemsStore: VehicleSystemsStore,
) : SafetyFeaturesSource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

    override fun safety(vehicleId: Long): Flow<Resource<JsonElement>> = vehicleSystemsStore.safety(vehicleId.toString())
}

/**
 * The shared **S7** repository-backed [SafetyFeaturesSource] — the cold cache-then-network feeds the S8
 * stores also wrap. Re-collecting performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh/retry affordance (the web `useSafety().refetch()`); the view-model reproduces
 * the standard trigger ▸ re-collect pipeline over this port. No HTTP touches the view.
 */
class RepositorySafetyFeaturesSource(
    private val vehiclesRepository: VehiclesRepository,
    private val vehicleSystemsRepository: VehicleSystemsRepository,
) : SafetyFeaturesSource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

    override fun safety(vehicleId: Long): Flow<Resource<JsonElement>> = vehicleSystemsRepository.safety(vehicleId.toString())
}
