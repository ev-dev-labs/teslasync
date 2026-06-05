package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Cache-then-network access to a vehicle's available-signals snapshot
 * (`GET /signals/{vehicleID}/available`). Cached per vehicle as a raw SI [JsonElement];
 * the 2-minute TTL matches the backend's live-state staleness contract. Live SSE
 * merging of this snapshot is an S8 concern.
 */
public class SignalsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Signals

    /** Streams the cached signals snapshot for [vehicleId] immediately, then the refresh. */
    public fun snapshot(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(vehicleId.toString()) {
            api.request<JsonElement>(path = "/signals/$vehicleId/available")
        }
}
