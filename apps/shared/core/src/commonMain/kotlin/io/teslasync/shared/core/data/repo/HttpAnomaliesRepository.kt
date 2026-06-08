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
 * HTTP-backed [AnomaliesRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single anomaly feed lives in the [CacheDomain.Anomalies] partition, keyed by a
 * stable `{vehicleId}:{days}` string so each `(vehicle, window)` tuple caches independently while
 * logout still clears the whole domain in one call.
 *
 * The read goes through the generic cache-then-network operator ([observe]). The web hook's
 * `staleTime: STALE_TIMES.SLOW` (5 minutes) maps onto the domain's 5-minute freshness window; the
 * finer-grained refetch cadence is a UI concern (the S8/platform layer chooses when to re-collect),
 * mirroring how the web `staleTime` only gates the freshness flag, not whether the
 * cache-then-network refresh runs. There are no mutations — the web hook file has none — so there
 * is nothing to invalidate.
 */
public class HttpAnomaliesRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    AnomaliesRepository {
    override val domain: CacheDomain = CacheDomain.Anomalies

    override fun anomalies(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> =
        observe("$vehicleId:$days") {
            api.request<JsonElement>(
                path = "/analytics/anomalies",
                query = mapOf("vehicle_id" to vehicleId, "days" to days.toString()),
            )
        }
}
