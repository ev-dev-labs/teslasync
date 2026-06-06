package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [PinnedRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every list read shares the single [CacheDomain.Pinned] partition, keyed by the web
 * TanStack list tuple via [pinnedCacheKey], so each `(type, context)` bucket is cached
 * independently while logout still clears the whole partition in one call.
 *
 * The mutations call the API directly and DO NOT touch the cache — invalidation is the S8 store's
 * targeted refresh (the web `invalidateQueries` analogue: a toggle refreshes every feed, a reorder
 * only the no-context feed), and `cacheThenNetwork` always hits the network on refresh so no stale
 * value is ever served as fresh while the last-known rows stay visible during the reload. The
 * unpin path's row-id lookup is served by [peekPinned] (the cached bucket, the web
 * `getQueryData` analogue) with [fetchPinned] as the cold-cache fresh-fetch fallback (the web
 * `await request(...)`), neither of which writes the cache from the mutation path.
 */
public class HttpPinnedRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<PinnedItem>>(store, clock, json, ListSerializer(PinnedItem.serializer())),
    PinnedRepository {
    override val domain: CacheDomain = CacheDomain.Pinned

    // ---- Reads --------------------------------------------------------------------

    override fun pinned(
        type: PinnedItemType,
        context: String?,
    ): Flow<Resource<List<PinnedItem>>> =
        observe(pinnedCacheKey(type, context)) {
            api.request<List<PinnedItem>>(path = "/pinned", query = pinnedQuery(type, context))
        }

    override suspend fun peekPinned(
        type: PinnedItemType,
        context: String?,
    ): List<PinnedItem>? = peek(pinnedCacheKey(type, context))?.data

    override suspend fun fetchPinned(
        type: PinnedItemType,
        context: String?,
    ): Result<List<PinnedItem>> = api.safeRequest<List<PinnedItem>>(path = "/pinned", query = pinnedQuery(type, context))

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createPin(
        type: PinnedItemType,
        itemId: String,
        context: String?,
    ): Result<PinnedItem> {
        val body =
            buildJsonObject {
                put("item_type", type.wire)
                put("item_id", itemId)
                // Web: `...(context != null ? { context } : {})` — present-when-non-null.
                if (context != null) put("context", context)
            }
        return api.safeRequest<PinnedItem>(method = HttpMethodKind.POST, path = "/pinned", body = jsonBody(body))
    }

    override suspend fun deletePin(id: Long): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = "/pinned/$id")
            .map { }

    override suspend fun reorderPin(
        id: Long,
        position: Int,
    ): Result<PinnedItem> {
        val body = buildJsonObject { put("position", position) }
        return api.safeRequest<PinnedItem>(method = HttpMethodKind.PATCH, path = "/pinned/$id", body = jsonBody(body))
    }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
