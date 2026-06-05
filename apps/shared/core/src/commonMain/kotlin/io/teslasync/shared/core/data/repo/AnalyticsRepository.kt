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
 * Cache-then-network access to analytics summary dashboards (e.g. `GET /analytics/fleet`).
 *
 * The analytics surface is a large, evolving set of aggregate read-models, so payloads
 * are cached as raw SI [JsonElement] rather than per-endpoint DTOs; typed projection is
 * deferred to the S8 state holders. Stored values are SI verbatim — never converted.
 */
public class AnalyticsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Analytics

    /**
     * Streams the cached analytics summary identified by [name] immediately, then the
     * refreshed payload fetched from [path] (path WITHOUT the `/api/v1` prefix).
     */
    public fun summary(
        name: String,
        path: String,
    ): Flow<Resource<JsonElement>> = observe(name) { api.request<JsonElement>(path = path) }

    /** Convenience accessor for the fleet-level summary (`GET /analytics/fleet`). */
    public fun fleet(): Flow<Resource<JsonElement>> = summary("fleet", "/analytics/fleet")
}
