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
 * HTTP-backed [CommandsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The two reads share the single [CacheDomain.Commands] partition under distinct prefixed
 * keys — [commandHistoryKey] / [commandLatestKey], mirroring the web `commandKeys.history` /
 * `commandKeys.latest` query keys — so each `(vehicle, feed)` tuple caches independently while
 * logout still clears the whole domain in one call.
 *
 * Both reads go through the generic cache-then-network operator ([observe]). The web hooks'
 * `staleTime`s (history `QUICK` 10s, latest `MODERATE` 15s) collapse onto the domain's single
 * 10-second freshness window; the finer-grained refetch cadence is a UI concern (the S8/platform
 * layer chooses when to re-collect), mirroring how the web `staleTime` only gates the freshness
 * flag, not whether the cache-then-network refresh runs. There are no mutations — the web hook file
 * has none — so there is nothing to invalidate.
 */
public class HttpCommandsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    CommandsRepository {
    override val domain: CacheDomain = CacheDomain.Commands

    override fun commandHistory(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(commandHistoryKey(vehicleId)) {
            api.request<JsonElement>(
                path = "/vehicles/$vehicleId/commands/history",
                query = commandHistoryQuery(),
            )
        }

    override fun commandLatest(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(commandLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/commands/latest")
        }
}
