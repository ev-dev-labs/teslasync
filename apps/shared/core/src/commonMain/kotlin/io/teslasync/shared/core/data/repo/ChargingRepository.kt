package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.ChargingSession
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
 * Cache-then-network access to a vehicle's charging sessions
 * (`GET /charging-sessions?vehicle_id={id}`). Cached per vehicle; SI energy/power
 * (Wh, W) are stored verbatim.
 */
public class ChargingRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<ChargingSession>>(
        store,
        clock,
        json,
        ListSerializer(ChargingSession.serializer()),
    ) {
    override val domain: CacheDomain = CacheDomain.Charging

    /** Streams cached charging sessions for [vehicleId] immediately, then the refreshed list. */
    public fun sessions(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
        observe(vehicleId.toString()) {
            api.request<List<ChargingSession>>(
                path = "/charging-sessions",
                query = mapOf("vehicle_id" to vehicleId.toString()),
            )
        }
}
