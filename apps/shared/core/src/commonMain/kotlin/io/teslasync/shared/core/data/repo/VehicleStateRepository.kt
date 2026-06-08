package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * Cache-then-network access to a vehicle's last-known state
 * (`GET /vehicles/{vehicleID}/state`). Keyed per vehicle and treated as live-ish: the
 * 2-minute TTL matches the backend's cross-pod staleness contract.
 */
public class VehicleStateRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<VehicleState>(store, clock, json, VehicleState.serializer()) {
    override val domain: CacheDomain = CacheDomain.VehicleState

    /** Streams the cached state for [vehicleId] immediately, then the refreshed state. */
    public fun state(vehicleId: Long): Flow<Resource<VehicleState>> =
        observe(vehicleId.toString()) {
            api.request<VehicleState>(path = "/vehicles/$vehicleId/state")
        }
}
