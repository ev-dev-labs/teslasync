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
 * HTTP-backed [FsmRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013).
 * Both FSM feeds share the single [CacheDomain.Fsm] partition, keyed by a stable per-feed string
 * that mirrors the web TanStack query keys (`fsmKeys`): the stats feed by `stats:{entityId}`, the
 * transitions feed by the [fsmTransitionsKey] tuple, so each distinct `(filter, window, page)`
 * caches independently while logout clears the whole partition in one call.
 *
 * Reads go through the generic cache-then-network operator ([observe]). The web hooks declare no
 * `staleTime` and poll on `INTERVALS.FAST` (10s); the domain's 10-second freshness window keeps the
 * freshness flag honest while the finer-grained refetch cadence is a UI concern (the S8/platform
 * layer chooses when to re-collect). There are no mutations — the web hook file has none — so there
 * is nothing to invalidate.
 */
public class HttpFsmRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    FsmRepository {
    override val domain: CacheDomain = CacheDomain.Fsm

    override fun stats(entityId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_STATS:$entityId") {
            api.request<JsonElement>(
                path = "/fsm/stats",
                query = mapOf("vehicle_id" to entityId),
            )
        }

    override fun transitions(
        entityId: String,
        fsmType: FsmType,
        hours: Int,
        page: Int,
        perPage: Int,
        startInstant: String?,
        endInstantExclusive: String?,
    ): Flow<Resource<JsonElement>> {
        val key = fsmTransitionsKey(entityId, fsmType, hours, page, perPage, startInstant, endInstantExclusive)
        return observe("$KEY_TRANSITIONS:$key") {
            api.request<JsonElement>(
                path = "/fsm/transitions",
                query = buildFsmTransitionsQuery(entityId, fsmType, hours, page, perPage, startInstant, endInstantExclusive),
            )
        }
    }

    private companion object {
        const val KEY_STATS = "stats"
        const val KEY_TRANSITIONS = "transitions"
    }
}
