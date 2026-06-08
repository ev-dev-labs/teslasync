package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.systemqueues.QueueJobsResponse
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [SystemQueuesRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The two reads share the single [CacheDomain.SystemQueues] partition under distinct
 * keys — [SYSTEM_QUEUES_STATUS_KEY] and [queueJobsCacheKey] — mirroring the web `queueKeys.status`
 * and `queueKeys.jobs(worker)` query keys, so each feed caches independently while logout clears the
 * whole partition in one call.
 *
 * Because the domain has two distinct read shapes ([QueueStatusResponse] and [QueueJobsResponse]),
 * the cache layer stores each feed's raw [JsonElement] (the same verbatim-SI strategy as the
 * Incident/FeatureFlags ports) via [CachingRepository] of [JsonElement], and each read decodes that
 * element to its typed model on every emission through [decode]. A typed decode failure on the fresh
 * value surfaces as [Resource.Error] (never a thrown exception that would cancel the flow before the
 * next refresh); a failure decoding a cached value degrades that slot to `null` so a schema-drifted
 * cache can never brick the network reload.
 *
 * The status feed uses the [CacheDomain.SystemQueues] 15-second default TTL (web
 * `QUEUE_STATUS_STALE_TIME_MS`); the per-worker jobs feed overrides it per-read to 30 seconds (web
 * `QUEUE_JOBS_STALE_TIME_MS`) so each flags staleness on its own web-faithful threshold. Both
 * endpoints answer with a bare typed body (no `{data:T}` envelope), exactly as the web hooks call
 * the plain `request<…>` without unwrapping; the resilient client adds the `/api/v1` prefix once.
 *
 * There are no mutations — the web hook file has none — so there is nothing to invalidate.
 */
public class HttpSystemQueuesRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    SystemQueuesRepository {
    override val domain: CacheDomain = CacheDomain.SystemQueues

    override fun queueStatus(): Flow<Resource<QueueStatusResponse>> =
        observe(SYSTEM_QUEUES_STATUS_KEY, QUEUE_STATUS_STALE_TIME_MS) {
            api.request<JsonElement>(path = QUEUES_STATUS_PATH)
        }.decode(QueueStatusResponse.serializer())

    override fun queueJobs(
        worker: String,
        limit: Int,
    ): Flow<Resource<QueueJobsResponse>> =
        observe(queueJobsCacheKey(worker), QUEUE_JOBS_STALE_TIME_MS) {
            api.request<JsonElement>(
                path = queueJobsPath(worker),
                query = mapOf("limit" to limit.toString()),
            )
        }.decode(QueueJobsResponse.serializer())

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every decode. */
    private fun <T> Flow<Resource<JsonElement>>.decode(serializer: KSerializer<T>): Flow<Resource<T>> = map { it.decodeTo(serializer) }

    private fun <T> Resource<JsonElement>.decodeTo(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { json.decodeFromJsonElement(serializer, data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer matches the DTO is a contract error, not a transport
                    // one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    private companion object {
        const val QUEUES_STATUS_PATH = "/system/queues"
    }
}
