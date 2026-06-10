package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [DlqRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013).
 * Every DLQ feed shares the single [CacheDomain.Dlq] partition, keyed by a stable per-feed string
 * that mirrors the web TanStack query keys (`dlqKeys`), so a feed can be read independently while
 * the replay mutation — and logout — clears the whole partition in one call.
 *
 * Reads go through the generic cache-then-network operator ([observe]). The replay mutation calls
 * the API directly and, on success, clears the entire [CacheDomain.Dlq] partition — the data-layer
 * analogue of the web hook's `invalidateQueries(['system','dlq'])`, which invalidates the whole
 * `['system','dlq']` query-key prefix (list + entry + audit).
 */
public class HttpDlqRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    DlqRepository {
    override val domain: CacheDomain = CacheDomain.Dlq

    // ---- Reads --------------------------------------------------------------------

    override fun list(): Flow<Resource<JsonElement>> = observe(KEY_LIST) { api.request<JsonElement>(path = "/system/dlq") }

    override fun entry(id: Long): Flow<Resource<JsonElement>> =
        observe("$KEY_ENTRY:$id") { api.request<JsonElement>(path = "/system/dlq/$id") }

    override fun audit(
        dlqId: Long?,
        limit: Int,
    ): Flow<Resource<JsonElement>> {
        val key = if (dlqAuditScoped(dlqId)) "$KEY_ENTRY_AUDIT:$dlqId:$limit" else "$KEY_AUDIT:$limit"
        return observe(key) {
            api.request<JsonElement>(
                path = dlqAuditPath(dlqId),
                query = mapOf("limit" to limit.toString()),
            )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun replayEntry(id: Long): Result<JsonElement> =
        api
            .safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/system/dlq/$id/replay")
            // invalidateQueries(['system','dlq']) analogue: the whole DLQ partition is evicted so
            // the next read of the list, the entry, or any audit feed re-fetches.
            .onSuccess { clear() }

    private companion object {
        const val KEY_LIST = "list"
        const val KEY_ENTRY = "entry"
        const val KEY_AUDIT = "audit"
        const val KEY_ENTRY_AUDIT = "entry-audit"
    }
}
