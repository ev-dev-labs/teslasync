// The data seam the SecuritySection feature view binds to + its shared-layer bindings and the security-primary
// two-feed merge — the native analogue of the web hook composition the host page performs before passing the
// `securityData` + `state` props down (web `useSecurityLatest` + `useVehicleState`; P1/S8 state-holder
// boundary). The web component itself is presentational; this port mirrors the host wiring: [vehicles]
// resolves the fallback active vehicle (web `vehicles?.[0]?.id`), [security] is the cache-then-network
// `SecurityEvent` feed (web `useSecurityLatest`, the primary input that gates the empty state), and
// [vehicleState] is the live `VehicleState` feed (web `useVehicleState`, carrying `is_locked` / `sentry_mode`).
// The view never performs HTTP itself, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecuritySection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitysection

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
 * The single seam the [SecuritySectionViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicles?.[0]?.id`); [security] is the cache-then-network latest-security feed (web `useSecurityLatest`,
 * the primary input); [vehicleState] is the live-state feed (web `useVehicleState`, carrying `is_locked` /
 * `sentry_mode`). No HTTP touches the view.
 */
interface SecuritySectionSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network latest security snapshot (web `useSecurityLatest`). */
    fun security(vehicleId: Long): Flow<Resource<JsonElement>>

    /** Stream one vehicle's cache-then-network live state (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every vehicle
 * surface shares app-wide (latest-security + live-state). Re-collecting these feeds performs a genuine
 * cache-then-network re-fetch, which backs the surface's refresh/retry affordance. No HTTP touches the view.
 */
fun VehiclesStore.asSecuritySectionSource(): SecuritySectionSource {
    val store = this
    return object : SecuritySectionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = store.securityLatest(vehicleId)

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Use this when a host wants the surface to own its own feed collection rather than
 * fold into the shared store. No HTTP touches the view.
 */
fun VehiclesRepository.asSecuritySectionSource(): SecuritySectionSource {
    val repo = this
    return object : SecuritySectionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = repo.securityLatest(vehicleId)

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)
    }
}

/**
 * A `GET /vehicles/{id}/state` "disabled" stand-in — an already-resolved no-state value that is never loading,
 * never errored, and contributes nothing to the freshness stamp. Used when no vehicle resolves so the merge can
 * fold the fleet resource onto a no-event security value while the live-state feed stays inert.
 */
internal val DISABLED_STATE: Resource<VehicleStateEnvelope> =
    Resource.Success(VehicleStateEnvelope(state = null, live = false), fetchedAt = 0L, stale = false)

/**
 * Composes the fleet list with the active vehicle's security + live-state feeds into one cache-then-network
 * [Resource] stream — the native port of the host's `id = vehicleId ?? vehicles?.[0]?.id` resolution feeding
 * `useSecurityLatest(id)` + `useVehicleState(id)`. A positive [preferredVehicleId] short-circuits straight to
 * its feeds (the vehicle list is not consulted when a prop id is supplied); otherwise the first enrolled
 * vehicle drives both feeds, and when neither resolves the fleet resource is folded onto a no-event security
 * value + the disabled-state stand-in so the surface renders its loading / empty / error state honestly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun securitySectionResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    securityFor: (Long) -> Flow<Resource<JsonElement>>,
    stateFor: (Long) -> Flow<Resource<VehicleStateEnvelope>>,
): Flow<Resource<SecuritySnapshot>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        combine(securityFor(preferred), stateFor(preferred)) { security, state -> mergeSecuritySection(security, state) }
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(mergeSecuritySection(vehiclesRes.toNoVehicleSecurity(), DISABLED_STATE))
                else -> combine(securityFor(id), stateFor(id)) { security, state -> mergeSecuritySection(security, state) }
            }
        }
    }
}

/**
 * Merges the cache-then-network security + live-state resources into one [Resource] of a [SecuritySnapshot] —
 * the native port of the host's two independent queries while keeping the freshness/error contract
 * **security-primary**: `updatedAt` / `isStale` / `isError` / `onRefresh` all come from the security feed; the
 * live-state feed only widens the first-load skeleton and supplies `is_locked` / `sentry_mode`, so a state
 * failure degrades those two tiles to the shared normalize defaults rather than a hard error. Precedence: a
 * first load on EITHER feed wins as the bare loading skeleton; then a security failure (offline over cache,
 * else hard error); then a security refetch over cache; otherwise success (a no-event snapshot → empty state).
 */
internal fun mergeSecuritySection(
    security: Resource<JsonElement>,
    state: Resource<VehicleStateEnvelope>,
): Resource<SecuritySnapshot> {
    val snapshot = securitySnapshotOrNull(security, state)
    val fetchedAt = security.fetchedAtOrNull()
    val stale = security.stale
    val securityFirstLoad = security is Resource.Loading && security.cached == null
    val stateFirstLoad = state is Resource.Loading && state.cached == null
    return when {
        securityFirstLoad || stateFirstLoad -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        security is Resource.Error -> securityErrorResource(snapshot, fetchedAt, stale, security)
        security is Resource.Loading -> Resource.Loading(snapshot, fetchedAt, stale)
        else -> Resource.Success(snapshot ?: SecuritySnapshot.EMPTY, fetchedAt ?: 0L, stale = false)
    }
}

/** The combined snapshot when either feed has a cached value, else `null` (a bare first load). */
private fun securitySnapshotOrNull(
    security: Resource<JsonElement>,
    state: Resource<VehicleStateEnvelope>,
): SecuritySnapshot? =
    if (security.cached != null || state.cached?.state != null) {
        SecuritySnapshot.from(security.cached, state.cached?.state)
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

/** Folds a fleet-list [Resource] onto a no-event security value, preserving loading/empty/error. */
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
