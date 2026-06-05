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
 * Cache-then-network access to the notification feed (`GET /notifications/`).
 *
 * Cached as a raw [JsonElement] so the feed renders instantly offline; the short
 * 1-minute TTL keeps the freshness badge honest for this fast-moving read-model.
 */
public class NotificationRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Notifications

    /** Streams the cached notification feed immediately, then the refreshed feed. */
    public fun feed(): Flow<Resource<JsonElement>> = observe(KEY) { api.request<JsonElement>(path = "/notifications/") }

    private companion object {
        const val KEY = "all"
    }
}
