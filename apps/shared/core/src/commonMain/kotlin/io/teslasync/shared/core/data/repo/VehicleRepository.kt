package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Cache-then-network access to the enrolled vehicle list (`GET /vehicles/`).
 * The list is cached as one entry; feature-level selection/derivation is an S8 concern.
 */
public class VehicleRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<Vehicle>>(store, clock, json, ListSerializer(Vehicle.serializer())) {
    override val domain: CacheDomain = CacheDomain.Vehicles

    /** Streams the cached vehicle list immediately, then the refreshed list. */
    public fun vehicles(): Flow<Resource<List<Vehicle>>> = observe(KEY) { api.request<List<Vehicle>>(path = "/vehicles/") }

    /** Write-through after a mutation that returns the updated list. */
    public suspend fun cache(vehicles: List<Vehicle>) {
        put(KEY, vehicles)
    }

    private companion object {
        const val KEY = "all"
    }
}
