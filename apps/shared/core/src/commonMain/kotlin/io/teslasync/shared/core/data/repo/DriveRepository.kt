package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.Drive
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
 * Cache-then-network access to a vehicle's recent drives
 * (`GET /drives/?vehicle_id={id}`). Cached per vehicle; SI distances/speeds are stored
 * verbatim (meters, m/s) and converted only at the display boundary.
 */
public class DriveRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<Drive>>(store, clock, json, ListSerializer(Drive.serializer())) {
    override val domain: CacheDomain = CacheDomain.Drives

    /** Streams cached drives for [vehicleId] immediately, then the refreshed list. */
    public fun drives(vehicleId: Long): Flow<Resource<List<Drive>>> =
        observe(vehicleId.toString()) {
            api.request<List<Drive>>(
                path = "/drives/",
                query = mapOf("vehicle_id" to vehicleId.toString()),
            )
        }
}
