package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.ktor.http.encodeURLPathPart
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagChangesResponse
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagEntry
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagWriteResponse
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagsListResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [FeatureFlagsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013) — the data-layer port of the web `useFeatureFlags` hooks. Every read shares the single
 * [CacheDomain.FeatureFlags] partition, keyed by a stable per-feed string ([flagsListCacheKey],
 * [flagCacheKey], [flagChangesCacheKey]) that mirrors the web TanStack query keys, so a feed is
 * cached independently while a mutation drops the whole partition in one call and logout still
 * clears everything.
 *
 * Because the domain has three distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the verbatim-SI strategy of the Charging/Admin ports) via [CachingRepository] of
 * [JsonElement], and each typed read decodes that element to its model on every emission through
 * [decode]. A typed decode failure on the fresh value surfaces as [Resource.Error] (never a thrown
 * exception that would cancel the flow before the next refresh); a failure decoding a cached value
 * degrades that slot to `null` so a schema-drifted cache can never brick the network reload.
 *
 * The two mutations are sudo-gated (the step-up is the networking layer's concern, S6) and, on
 * success, evict the ENTIRE partition ([clear]) — the data-layer analogue of the web hooks
 * invalidating the `['system','flags']` prefix. A failed mutation leaves the cache untouched.
 */
public class HttpFeatureFlagsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    FeatureFlagsRepository {
    override val domain: CacheDomain = CacheDomain.FeatureFlags

    // ---- Reads --------------------------------------------------------------------

    override fun flags(): Flow<Resource<FeatureFlagsListResponse>> =
        observe(flagsListCacheKey()) { api.request<JsonElement>(path = "/system/flags") }
            .decode(FeatureFlagsListResponse.serializer())

    override fun flag(key: String): Flow<Resource<FeatureFlagEntry>> =
        observe(flagCacheKey(key)) {
            api.request<JsonElement>(path = "/system/flags/${key.encodeURLPathPart()}")
        }.decode(FeatureFlagEntry.serializer())

    override fun flagChanges(
        flagKey: String?,
        limit: Int,
    ): Flow<Resource<FeatureFlagChangesResponse>> =
        observe(flagChangesCacheKey(flagKey, limit)) {
            val path =
                if (flagChangesScoped(flagKey)) {
                    "/system/flags/${flagKey!!.encodeURLPathPart()}/changes"
                } else {
                    "/system/flags/changes"
                }
            api.request<JsonElement>(path = path, query = mapOf("limit" to limit.toString()))
        }.decode(FeatureFlagChangesResponse.serializer())

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun setFlag(
        key: String,
        value: JsonElement,
        reason: String,
    ): Result<FeatureFlagWriteResponse> {
        // Mirrors the web `FeatureFlagSetRequest` body `{ value, reason }`; `value` is the raw
        // arbitrary-JSON element, emitted unchanged.
        val body =
            buildJsonObject {
                put("value", value)
                put("reason", reason)
            }
        return api
            .safeRequest<FeatureFlagWriteResponse>(
                method = HttpMethodKind.PUT,
                path = "/system/flags/${key.encodeURLPathPart()}",
                body = jsonBody(body),
            ).onSuccess { clear() }
    }

    override suspend fun deleteFlag(
        key: String,
        reason: String,
    ): Result<FeatureFlagWriteResponse> =
        // `reason` is required by the backend and carried as a query param — the verbatim web
        // `URLSearchParams({ reason })`, not a body.
        api
            .safeRequest<FeatureFlagWriteResponse>(
                method = HttpMethodKind.DELETE,
                path = "/system/flags/${key.encodeURLPathPart()}",
                query = mapOf("reason" to reason),
            ).onSuccess { clear() }

    // ---- Internals ----------------------------------------------------------------

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every decode. */
    private fun <T> Flow<Resource<JsonElement>>.decode(serializer: KSerializer<T>): Flow<Resource<T>> =
        map { resource -> resource.decodeTo(serializer) }

    private fun <T> Resource<JsonElement>.decodeTo(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { json.decodeFromJsonElement(serializer, data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
