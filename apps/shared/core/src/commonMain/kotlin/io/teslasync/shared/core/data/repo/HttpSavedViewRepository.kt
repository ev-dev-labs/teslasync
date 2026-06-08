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
import io.teslasync.shared.core.presentation.savedviews.SavedView
import io.teslasync.shared.core.presentation.savedviews.SavedViewCreateInput
import io.teslasync.shared.core.presentation.savedviews.SavedViewUpdateInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [SavedViewRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every list read shares the single [CacheDomain.SavedViews] partition, keyed by the web
 * TanStack scope tuple via [savedViewCacheKey] (the `route` string), so each list page is cached
 * independently while a mutation evicts ONLY its own route key and logout still clears everything.
 *
 * The list read is cached as a typed `List<SavedView>`; the opaque `query` blob round-trips verbatim
 * as a raw string. Mutations call the API directly and, on success, evict ONLY the affected route's
 * key ([evict]) — the data-layer analogue of the web hooks invalidating `savedViewsKeys.list(route)`
 * (a single-key `removeQueries`, never the whole `all` prefix).
 */
public class HttpSavedViewRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<SavedView>>(
        store,
        clock,
        json,
        ListSerializer(SavedView.serializer()),
    ),
    SavedViewRepository {
    override val domain: CacheDomain = CacheDomain.SavedViews

    // ---- Read ---------------------------------------------------------------------

    override fun savedViews(route: String): Flow<Resource<List<SavedView>>> =
        observe(savedViewCacheKey(route)) {
            api.request<List<SavedView>>(path = SAVED_VIEWS_PATH, query = savedViewListQuery(route))
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createSavedView(input: SavedViewCreateInput): Result<SavedView> {
        val body =
            buildJsonObject {
                put("name", input.name)
                put("route", input.route)
                put("query", input.query)
                input.isDefault?.let { put("is_default", it) }
                input.isPinned?.let { put("is_pinned", it) }
                input.sortOrder?.let { put("sort_order", it) }
            }
        return api
            .safeRequest<SavedView>(method = HttpMethodKind.POST, path = SAVED_VIEWS_PATH, body = jsonBody(body))
            // The web `onSuccess` invalidates `savedViewsKeys.list(created.route)` — evict the
            // created row's own route key, exactly the page the new view belongs to.
            .onSuccess { evict(savedViewCacheKey(it.route)) }
    }

    override suspend fun updateSavedView(
        id: Long,
        route: String,
        patch: SavedViewUpdateInput,
    ): Result<SavedView> {
        val body =
            buildJsonObject {
                // Mirror the web `JSON.stringify(patch)`: every field is sent only when supplied so a
                // partial update never overwrites untouched fields.
                patch.name?.let { put("name", it) }
                patch.query?.let { put("query", it) }
                patch.isDefault?.let { put("is_default", it) }
                patch.isPinned?.let { put("is_pinned", it) }
                patch.sortOrder?.let { put("sort_order", it) }
            }
        return api
            .safeRequest<SavedView>(method = HttpMethodKind.PUT, path = "$SAVED_VIEWS_PATH/$id", body = jsonBody(body))
            .onSuccess { evict(savedViewCacheKey(route)) }
    }

    override suspend fun deleteSavedView(
        id: Long,
        route: String,
    ): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = "$SAVED_VIEWS_PATH/$id")
            .map { }
            .onSuccess { evict(savedViewCacheKey(route)) }

    override suspend fun setDefaultSavedView(
        id: Long,
        route: String,
        isDefault: Boolean,
    ): Result<SavedView> {
        // The web `useSetDefaultSavedView` sends `{ is_default }` to the same Update endpoint.
        val body = buildJsonObject { put("is_default", isDefault) }
        return api
            .safeRequest<SavedView>(method = HttpMethodKind.PUT, path = "$SAVED_VIEWS_PATH/$id", body = jsonBody(body))
            .onSuccess { evict(savedViewCacheKey(route)) }
    }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach the
     * wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies (including the opaque
     * `query` blob).
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private companion object {
        const val SAVED_VIEWS_PATH = "/saved-views"
    }
}
