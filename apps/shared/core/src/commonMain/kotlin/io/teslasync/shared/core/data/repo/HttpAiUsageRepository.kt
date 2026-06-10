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
 * HTTP-backed [AiUsageRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). All three AI-usage feeds share the single [CacheDomain.AiUsage] partition, keyed
 * by a stable per-feed string that mirrors the web TanStack query keys
 * (`['ai','usage','today']`, `['ai','usage','by-feature', since ?? '']`,
 * `['ai','usage','recent', limit ?? 0]`), so each `(feed, params)` tuple caches independently
 * while logout still clears the whole domain in one call.
 *
 * Reads go through the generic cache-then-network operator ([observe]). The optional `since`
 * and `limit` query params are passed as nullable map values: a null value is dropped on the
 * wire by the client, reproducing the web hook's conditional-path behaviour (omit the param
 * entirely when absent) without a second code path. There are no mutations — the web hook file
 * has none — so there is nothing to invalidate.
 */
public class HttpAiUsageRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    AiUsageRepository {
    override val domain: CacheDomain = CacheDomain.AiUsage

    override fun today(): Flow<Resource<JsonElement>> = observe(KEY_TODAY) { api.request<JsonElement>(path = "/ai/usage/today") }

    override fun byFeature(since: String?): Flow<Resource<JsonElement>> =
        observe("$KEY_BY_FEATURE:${since ?: ""}") {
            api.request<JsonElement>(
                path = "/ai/usage/by-feature",
                query = mapOf("since" to since),
            )
        }

    override fun recent(limit: Int?): Flow<Resource<JsonElement>> =
        observe("$KEY_RECENT:${limit ?: 0}") {
            api.request<JsonElement>(
                path = "/ai/usage/recent",
                query = mapOf("limit" to limit?.toString()),
            )
        }

    private companion object {
        const val KEY_TODAY = "today"
        const val KEY_BY_FEATURE = "by-feature"
        const val KEY_RECENT = "recent"
    }
}
