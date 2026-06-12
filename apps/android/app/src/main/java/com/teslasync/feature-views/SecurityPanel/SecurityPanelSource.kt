// The data seam the SecurityPanel feature view binds to + its shared-layer bindings and the
// security-primary two-feed merge — the native analogue of the web `useVehicles` + `useSecurityLatest` +
// `useVehicleConfigLatest` hook composition the host page performs before passing the `securityData` +
// `remoteStartEnabled` props down (web/src/api/hooks/useVehicles.ts; P1/S8 state-holder boundary). The
// web component itself is presentational; this port mirrors the host wiring: [vehicles] resolves the
// fallback active vehicle (web `vehicles?.[0]?.id`), [security] is the cache-then-network `SecurityEvent`
// feed (web `useSecurityLatest`, the primary input), and [vehicleConfig] is the latest vehicle-config feed
// (web `useVehicleConfigLatest`, carrying `remote_start_enabled` — the `remoteStartEnabled` prop). The view
// never performs HTTP itself, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecurityPanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitypanel

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [SecurityPanelViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicles?.[0]?.id`); [security] is the cache-then-network latest-security feed (web
 * `useSecurityLatest`, the primary input); [vehicleConfig] is the latest vehicle-config feed (web
 * `useVehicleConfigLatest`, carrying `remote_start_enabled`). No HTTP touches the view.
 */
interface SecurityPanelSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network latest security snapshot (web `useSecurityLatest`). */
    fun security(vehicleId: Long): Flow<Resource<JsonElement>>

    /** Stream one vehicle's cache-then-network latest vehicle-config snapshot (web `useVehicleConfigLatest`). */
    fun vehicleConfig(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch,
 * which backs the panel's refresh/retry affordance (the web `useSecurityLatest().refetch()`). No HTTP
 * touches the view.
 */
fun VehiclesRepository.asSecurityPanelSource(): SecurityPanelSource {
    val repo = this
    return object : SecurityPanelSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = repo.securityLatest(vehicleId)

        override fun vehicleConfig(vehicleId: Long): Flow<Resource<JsonElement>> = repo.vehicleConfigLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every
 * vehicle surface shares app-wide. Use this when a host wants the panel to fold into the same shared feeds
 * as the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asSecurityPanelSource(): SecurityPanelSource {
    val store = this
    return object : SecurityPanelSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = store.securityLatest(vehicleId)

        override fun vehicleConfig(vehicleId: Long): Flow<Resource<JsonElement>> = store.vehicleConfigLatest(vehicleId)
    }
}

/**
 * A `GET /vehicle-config/latest` "disabled" stand-in — the native analogue of the web
 * `useVehicleConfigLatest(0)` lazy gate (`enabled: id > 0`): an already-resolved no-config value that is
 * never loading, never errored, and contributes nothing to the freshness stamp.
 */
internal val DISABLED_CONFIG: Resource<JsonElement> = Resource.Success(JsonNull, fetchedAt = 0L, stale = false)

/**
 * Composes the fleet list with the active vehicle's security + latest-config feeds into one
 * cache-then-network [Resource] stream — the native port of the host's `id = vehicleId ?? vehicles?.[0]?.id`
 * resolution feeding `useSecurityLatest(id)` + `useVehicleConfigLatest(id)`. A positive [preferredVehicleId]
 * short-circuits straight to its feeds (the vehicle list is not consulted when a prop id is supplied);
 * otherwise the first enrolled vehicle drives both feeds, and when neither resolves the fleet resource is
 * folded onto a no-snapshot security value + the disabled-config stand-in so the surface renders its
 * loading / empty / error state honestly (the disabled `enabled: id > 0` query → undefined snapshot → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun securityPanelResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    securityFor: (Long) -> Flow<Resource<JsonElement>>,
    configFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<SecuritySnapshot>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        combine(securityFor(preferred), configFor(preferred)) { s, c -> mergeSecurity(s, c) }
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(mergeSecurity(vehiclesRes.toNoVehicleSecurity(), DISABLED_CONFIG))
                else -> combine(securityFor(id), configFor(id)) { s, c -> mergeSecurity(s, c) }
            }
        }
    }
}

/**
 * Merges the cache-then-network security + latest-config resources into one [Resource] of a
 * [SecuritySnapshot] — the native port of the host's two independent queries while keeping the
 * freshness/error contract **security-primary**: `updatedAt`/`isFetching`/`isStale`/`isError`/`onRefresh`
 * all come from the security feed; the config feed only widens the first-load skeleton and supplies the
 * `remote_start_enabled` flag, so a config failure degrades the Remote-Start row to "—" rather than a hard
 * error. Precedence: a first load on EITHER feed wins as the bare loading skeleton; then a security failure
 * (offline over cache, else hard error); then a security refetch over cache; otherwise success.
 */
fun mergeSecurity(
    security: Resource<JsonElement>,
    config: Resource<JsonElement>,
): Resource<SecuritySnapshot> {
    val snapshot = securitySnapshotOrNull(security, config)
    val fetchedAt = security.fetchedAtOrNull()
    val stale = security.stale
    val securityFirstLoad = security is Resource.Loading && security.cached == null
    val configFirstLoad = config is Resource.Loading && config.cached == null
    return when {
        securityFirstLoad || configFirstLoad -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        security is Resource.Error -> securityErrorResource(snapshot, fetchedAt, stale, security)
        security is Resource.Loading -> Resource.Loading(snapshot, fetchedAt, stale)
        else -> Resource.Success(snapshot ?: SecuritySnapshot.EMPTY, fetchedAt ?: 0L, stale = false)
    }
}

/** The combined snapshot when either feed has a cached value, else `null` (a bare first load). */
private fun securitySnapshotOrNull(
    security: Resource<JsonElement>,
    config: Resource<JsonElement>,
): SecuritySnapshot? =
    if (security.cached != null || config.cached != null) {
        SecuritySnapshot.from(security.cached, config.cached)
    } else {
        null
    }

/** A security failure keeps the cached snapshot visible as offline (stale); with no cache it is a hard error. */
private fun securityErrorResource(
    snapshot: SecuritySnapshot?,
    fetchedAt: Long?,
    stale: Boolean,
    security: Resource.Error<JsonElement>,
): Resource<SecuritySnapshot> =
    if (security.cached != null) {
        Resource.Error(snapshot, fetchedAt, stale = true, error = security.error)
    } else {
        Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = security.error)
    }

/** Folds a fleet-list [Resource] onto a no-snapshot security value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleSecurity(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }

/** The freshness stamp of any [Resource] variant (web `dataUpdatedAt`). */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
internal fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
