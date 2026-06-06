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
import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.CreateShareResponse
import io.teslasync.shared.core.presentation.sharing.ShareToken
import io.teslasync.shared.core.presentation.sharing.SharedDrive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [SharingRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Both reads share the single [CacheDomain.Sharing] partition under distinct keys
 * ([shareLinksCacheKey] / [sharedDriveCacheKey], the web `sharingKeys` tuples), each with its own
 * web-faithful per-entity TTL ([SHARE_LINKS_TTL_MILLIS] = 0 / [SHARED_DRIVE_TTL_MILLIS] = 5m). The
 * raw [JsonElement] is cached verbatim (the same SI-preserving strategy as the Push/Notification
 * ports) and decoded to the typed model on every emission through [decode]; a typed decode failure
 * on the fresh value surfaces as [Resource.Error] (never a thrown exception that would cancel the
 * flow), and a failure decoding a cached value degrades that slot to `null` so a schema-drifted
 * cache can never brick the network reload.
 *
 * The two mutations call the API directly and return a non-throwing [Result]. On success each
 * evicts ONLY the affected drive's [shareLinksCacheKey] ([evict]) — the data-layer analogue of the
 * web hooks invalidating ONLY `sharingKeys.shares(driveId)` — leaving the public `shared-drive`
 * feed and every other drive's links untouched. Bodies are serialized to exact JSON bytes via
 * [TextContent] for byte-for-byte parity with the web `JSON.stringify` payload; the revoke answers
 * `{ status }`, whose body is read as raw text and discarded so the response shape never triggers a
 * spurious decode failure.
 */
public class HttpSharingRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    SharingRepository {
    override val domain: CacheDomain = CacheDomain.Sharing

    // ---- Reads --------------------------------------------------------------------

    override fun shareLinks(driveId: String): Flow<Resource<List<ShareToken>>> =
        observe(shareLinksCacheKey(driveId), SHARE_LINKS_TTL_MILLIS) {
            safeArray(api.request<JsonElement>(path = "/drives/$driveId/shares"))
        }.decode(ListSerializer(ShareToken.serializer()))

    override fun sharedDrive(token: String): Flow<Resource<SharedDrive>> =
        observe(sharedDriveCacheKey(token), SHARED_DRIVE_TTL_MILLIS) {
            api.request<JsonElement>(path = "/share/$token")
        }.decode(SharedDriveSerializer)

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createShareLink(
        driveId: String,
        request: CreateShareRequest,
    ): Result<CreateShareResponse> =
        api
            .safeRequest<CreateShareResponse>(
                method = HttpMethodKind.POST,
                path = "/drives/$driveId/share",
                body = jsonBody(createShareBody(request)),
            ).onSuccess { evict(shareLinksCacheKey(driveId)) }

    override suspend fun revokeShareLink(
        driveId: String,
        token: String,
    ): Result<Unit> =
        // The server answers `{ status }`; read the body as raw text and discard so the response
        // shape never triggers a spurious decode failure.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = "/shares/$token")
            .map { }
            .onSuccess { evict(shareLinksCacheKey(driveId)) }

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

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` body.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
