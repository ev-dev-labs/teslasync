// The data seam the RedisSignalViewerPage admin surface binds to, plus its production binding over the shared S8
// Vehicles holder and the one resilient API client. The view (composable) performs NO HTTP — it only collects
// state from the view-model, which drives this seam, reproducing the web page's reads (`useVehicles` for the
// picker; `getRedisSignals` / `getRedisSignalKeys` for the cached snapshot + the "other vehicles" chips) and the
// two destructive mutations (`purgeRedisSignals` / `purgeAllRedisSignals`).
//
// `useVehicles` is the cache-then-network `Resource` stream the shared S8 VehiclesStore already exposes
// (`GET /vehicles`). The redis dev-tools endpoints have no shared-core store (they were never ported — no
// platform implemented this page before), so this binding wraps them over the same single, resilient
// [io.teslasync.shared.core.net.ApiHttpClient] the rest of the app uses, decoding the verbatim server JSON into a
// `Resource<JsonElement>` exactly as the shared AdminStore does for its sibling `/dev-tools/*` feeds. A narrow
// seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on the network. Each read
// (re)collection is a fresh cache-then-network stream, so the view-model's refresh trigger re-subscribing
// performs the web `refetch()` / `refetchInterval`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.redissignals

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement

/** Wall-clock seam for the success freshness stamp; production uses [System.currentTimeMillis], tests inject. */
fun interface RedisClock {
    fun nowMillis(): Long
}

/**
 * The single seam the [RedisSignalViewerPageViewModel] depends on so it binds to an abstraction (the shared
 * Vehicles holder + the resilient client in production, a fake in tests), never to a concrete store or the
 * network. The two reads are cache-then-network `Resource` flows (the web read hooks); the two mutations are
 * non-throwing suspend [Result]s (the web destructive calls). No HTTP touches the view.
 */
interface RedisSignalViewerSource {
    /** The fleet list feed for the vehicle picker (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The per-vehicle cached-signal snapshot feed (web `getRedisSignals(vehicleId)`). */
    fun redisSignals(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cluster-wide cached-key roster feed for the "other vehicles" chips (web `getRedisSignalKeys`). */
    fun redisSignalKeys(): Flow<Resource<JsonElement>>

    /** Delete one vehicle's Redis HSET (web `purgeRedisSignals(vehicleId)`); returns the `{purged}` envelope. */
    suspend fun purge(vehicleId: Long): Result<JsonElement>

    /** Delete every vehicle's Redis HSET (web `purgeAllRedisSignals()`); returns the `{purged,limit,has_more}`. */
    suspend fun purgeAll(): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] (the memoized, multi-observer fleet feed every surface
 * shares) and the resilient [api] for the redis dev-tools endpoints. The live values flow through unchanged so
 * the view-model renders the full state matrix (loading / content / empty / error / stale / offline) for each
 * source. No HTTP touches the view; the breaker/retry/401-refresh live in [api].
 *
 * @param clock the success freshness-stamp seam; production passes the system clock.
 */
fun redisSignalViewerSource(
    vehiclesStore: VehiclesStore,
    api: ApiHttpClient,
    clock: RedisClock = RedisClock { System.currentTimeMillis() },
): RedisSignalViewerSource =
    object : RedisSignalViewerSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun redisSignals(vehicleId: Long): Flow<Resource<JsonElement>> =
            cacheThenNetwork {
                api.safeRequest(
                    path = "/dev-tools/redis-signals",
                    query = mapOf("vehicle_id" to vehicleId.toString()),
                )
            }

        override fun redisSignalKeys(): Flow<Resource<JsonElement>> =
            cacheThenNetwork {
                api.safeRequest(
                    path = "/dev-tools/redis-signals/keys",
                    query = mapOf("limit" to RedisSignalViewerPageRegistration.KEYS_LIMIT.toString()),
                )
            }

        override suspend fun purge(vehicleId: Long): Result<JsonElement> =
            api.safeRequest(
                method = HttpMethodKind.DELETE,
                path = "/dev-tools/redis-signals",
                query = mapOf("vehicle_id" to vehicleId.toString()),
            )

        override suspend fun purgeAll(): Result<JsonElement> =
            api.safeRequest(
                method = HttpMethodKind.DELETE,
                path = "/dev-tools/redis-signals/keys",
            )

        /**
         * Emits the cold-start [Resource.Loading] then exactly one terminal [Resource.Success]/[Resource.Error] —
         * the minimal cache-then-network shape the [io.teslasync.android.data.UiState] projection consumes. The
         * resilient client owns retry/breaker, so a transient blip is already absorbed before the failure case.
         */
        fun cacheThenNetwork(fetch: suspend () -> Result<JsonElement>): Flow<Resource<JsonElement>> =
            flow {
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    fetch().fold(
                        onSuccess = { Resource.Success(it, fetchedAt = clock.nowMillis(), stale = false) },
                        onFailure = { Resource.Error(cached = null, fetchedAt = null, stale = false, error = it) },
                    ),
                )
            }
    }
