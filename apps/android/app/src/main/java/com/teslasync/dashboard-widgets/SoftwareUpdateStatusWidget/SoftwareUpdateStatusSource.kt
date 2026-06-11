// The data seam the Software Update Status widget binds to + its shared-layer bindings and the
// state-primary two-feed merge — the native analogue of the web `useVehicles` + `useVehicleState` +
// `useVehicleConfigLatest` hook composition (web/src/api/hooks/useVehicles.ts; P1/S8 state-holder boundary).
// The view never performs HTTP itself, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SoftwareUpdateStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.softwareupdatestatus

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [SoftwareUpdateStatusWidgetViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the
 * default vehicle (web `vehicles?.[0]?.id`); [vehicleState] is the cache-then-network state feed (web
 * `useVehicleState`, carrying `software_version`); [vehicleConfig] is the latest vehicle-config feed (web
 * `useVehicleConfigLatest`, carrying the `software_update_*` fields). No HTTP touches the view.
 */
interface SoftwareUpdateStatusSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network state envelope (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** Stream one vehicle's cache-then-network latest vehicle-config snapshot (web `useVehicleConfigLatest`). */
    fun vehicleConfig(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch,
 * which backs the widget's manual refresh/retry affordance (the web `useVehicleState().refetch()`). No HTTP
 * touches the view.
 */
fun VehiclesRepository.asSoftwareUpdateStatusSource(): SoftwareUpdateStatusSource {
    val repo = this
    return object : SoftwareUpdateStatusSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)

        override fun vehicleConfig(vehicleId: Long): Flow<Resource<JsonElement>> = repo.vehicleConfigLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every
 * vehicle surface shares app-wide. Use this when a host wants the widget to fold into the same shared
 * collections as the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asSoftwareUpdateStatusSource(): SoftwareUpdateStatusSource {
    val store = this
    return object : SoftwareUpdateStatusSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)

        override fun vehicleConfig(vehicleId: Long): Flow<Resource<JsonElement>> = store.vehicleConfigLatest(vehicleId)
    }
}

/** The resolved-no-vehicle envelope (web `useVehicleState(0)` ⇒ `{ state: undefined }` ⇒ empty surface). */
private val EMPTY_VEHICLE_STATE: VehicleStateEnvelope = VehicleStateEnvelope(state = null, live = false)

/**
 * A `GET /vehicle-config/latest` "disabled" stand-in — the native analogue of the web
 * `useVehicleConfigLatest(0)` lazy gate (`enabled: id > 0`): an already-resolved no-config value that is
 * never loading, never errored, and contributes nothing to the freshness stamp.
 */
internal val DISABLED_CONFIG: Resource<JsonElement> = Resource.Success(JsonNull, fetchedAt = 0L, stale = false)

/**
 * Composes the fleet list with the active vehicle's state + latest-config feeds into one cache-then-network
 * [Resource] stream — the native port of the web `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution
 * feeding `useVehicleState(id)` + `useVehicleConfigLatest(id)`. A positive [preferredVehicleId]
 * short-circuits straight to its feeds (the web vehicle-list is not consulted when a prop id is supplied);
 * otherwise the first enrolled vehicle drives both feeds, and when neither resolves the fleet resource is
 * folded onto a no-vehicle state envelope + the disabled-config stand-in so the surface renders its
 * loading / empty / error state honestly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun softwareUpdateResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    stateFor: (Long) -> Flow<Resource<VehicleStateEnvelope>>,
    configFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<SoftwareUpdateSnapshot>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        combine(stateFor(preferred), configFor(preferred)) { s, c -> mergeSoftwareUpdate(s, c) }
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(mergeSoftwareUpdate(vehiclesRes.toNoVehicleState(), DISABLED_CONFIG))
                else -> combine(stateFor(id), configFor(id)) { s, c -> mergeSoftwareUpdate(s, c) }
            }
        }
    }
}

/**
 * Merges the cache-then-network vehicle-state + latest-config resources into one [Resource] of a
 * [SoftwareUpdateSnapshot] — the native port of the web `isLoading = stateLoading || configLoading` gate
 * while keeping the freshness/error contract **state-primary**, exactly as the web `WidgetShell` does
 * (`updatedAt`/`isFetching`/`isStale`/`isError`/`onRefresh` all come from `useVehicleState`; the config
 * feed only widens the first-load skeleton and supplies the `software_update_*` fields, so a config failure
 * degrades to "up to date" rather than a hard error). Precedence: a first load on EITHER feed wins as the
 * bare loading skeleton; then a state failure (offline over cache, else hard error); then a state refetch
 * over cache; otherwise success.
 */
fun mergeSoftwareUpdate(
    state: Resource<VehicleStateEnvelope>,
    config: Resource<JsonElement>,
): Resource<SoftwareUpdateSnapshot> {
    val snapshot = softwareUpdateSnapshotOrNull(state, config)
    val fetchedAt = state.fetchedAtOrNull()
    val stale = state.stale
    val stateFirstLoad = state is Resource.Loading && state.cached == null
    val configFirstLoad = config is Resource.Loading && config.cached == null
    return when {
        stateFirstLoad || configFirstLoad -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        state is Resource.Error -> softwareUpdateErrorResource(snapshot, fetchedAt, stale, state)
        state is Resource.Loading -> Resource.Loading(snapshot, fetchedAt, stale)
        else -> Resource.Success(snapshot ?: SoftwareUpdateSnapshot.EMPTY, fetchedAt ?: 0L, stale = false)
    }
}

private fun softwareUpdateSnapshotOrNull(
    state: Resource<VehicleStateEnvelope>,
    config: Resource<JsonElement>,
): SoftwareUpdateSnapshot? =
    if (state.cached != null || config.cached != null) {
        SoftwareUpdateSnapshot.from(state.cached, config.cached)
    } else {
        null
    }

/** A state failure keeps the cached snapshot visible as offline (stale); with no cache it is a hard error. */
private fun softwareUpdateErrorResource(
    snapshot: SoftwareUpdateSnapshot?,
    fetchedAt: Long?,
    stale: Boolean,
    state: Resource.Error<VehicleStateEnvelope>,
): Resource<SoftwareUpdateSnapshot> =
    if (state.cached != null) {
        Resource.Error(snapshot, fetchedAt, stale = true, error = state.error)
    } else {
        Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = state.error)
    }

/** Folds a fleet-list [Resource] onto a no-vehicle state envelope, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleState(): Resource<VehicleStateEnvelope> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(EMPTY_VEHICLE_STATE, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }

/** The freshness stamp of any [Resource] variant (web `dataUpdatedAt`). */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }
