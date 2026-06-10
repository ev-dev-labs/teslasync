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
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewRequest
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewResult
import io.teslasync.shared.core.presentation.notificationchannels.WebhookTestResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [NotificationChannelsRepository] over the resilient [ApiHttpClient] and the offline
 * cache (ADR-013). The channel list shares the [CacheDomain.Notifications] partition, keyed by
 * [channelsKey] (the web `notificationKeys.channels` query key). The list's raw [JsonElement] is
 * cached verbatim (the same SI-preserving strategy as the Admin/Automations ports) and decoded to
 * the typed [NotificationChannel] union on every emission through [decode]; a typed decode failure
 * on the fresh value surfaces as [Resource.Error] (never a thrown exception that would cancel the
 * flow before the next refresh), and a failure decoding a cached value degrades that slot to
 * `null` so a schema-drifted cache can never brick the network reload.
 *
 * The two mutations call the API directly and return a non-throwing [Result]. They do NOT evict
 * the durable cache and do NOT invalidate the list (the web `useTestWebhookChannel` /
 * `useWebhookSignaturePreview` mutations invalidate no query keys); the S8 store's explicit
 * invalidate action (web `useInvalidateWebhookChannels`) is the only refresh trigger. The
 * webhook-test endpoint answers HTTP 200 in every delivery outcome, so a non-2xx receiver decodes
 * to a `success == false` [WebhookTestResult] rather than failing the [Result]. Bodies are
 * serialized to exact JSON bytes via [TextContent] for byte-for-byte parity with the web
 * `JSON.stringify` payloads.
 */
public class HttpNotificationChannelsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    NotificationChannelsRepository {
    override val domain: CacheDomain = CacheDomain.Notifications

    // ---- Reads --------------------------------------------------------------------

    override fun channels(): Flow<Resource<List<NotificationChannel>>> =
        observe(channelsKey()) { safeArray(api.request<JsonElement>(path = "/notifications")) }
            .decode(ListSerializer(NotificationChannel.serializer()))

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun testWebhookChannel(
        id: Long,
        title: String?,
        message: String?,
    ): Result<WebhookTestResult> {
        val body = webhookTestBody(title, message)
        // An empty body means "use server defaults" — send no payload at all, mirroring the web
        // mutationFn that only attaches a body/Content-Type when at least one field is present.
        return api.safeRequest<WebhookTestResult>(
            method = HttpMethodKind.POST,
            path = "/notifications/$id/webhook-test",
            body = if (body.isEmpty()) null else jsonBody(body),
        )
    }

    override suspend fun previewWebhookSignature(
        secret: String,
        body: String,
    ): Result<WebhookSignaturePreviewResult> {
        val request = WebhookSignaturePreviewRequest(secret = secret, body = body)
        val bytes = json.encodeToString(WebhookSignaturePreviewRequest.serializer(), request)
        return api.safeRequest<WebhookSignaturePreviewResult>(
            method = HttpMethodKind.POST,
            path = "/notifications/webhooks/preview-signature",
            body = TextContent(bytes, ContentType.Application.Json),
        )
    }

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
                    // A 2xx body that no longer matches the DTO is a contract error, not a
                    // transport one — surface it without throwing across the flow boundary.
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
