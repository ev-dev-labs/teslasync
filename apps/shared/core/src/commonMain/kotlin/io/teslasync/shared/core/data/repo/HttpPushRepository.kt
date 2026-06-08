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
import io.teslasync.shared.core.presentation.push.PushPublicKey
import io.teslasync.shared.core.presentation.push.PushSubscribeBody
import io.teslasync.shared.core.presentation.push.PushSubscription
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [PushRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013).
 * Both reads share the single [CacheDomain.Push] partition under distinct keys ([pushPublicKeyKey]
 * / [pushSubscriptionsKey], the web `pushKeys` tuples), each with its own web-faithful per-entity
 * TTL ([PUSH_PUBLIC_KEY_TTL_MILLIS] / [PUSH_SUBSCRIPTIONS_TTL_MILLIS]). The raw [JsonElement] is
 * cached verbatim (the same SI-preserving strategy as the Notification/Pinned ports) and decoded
 * to the typed model on every emission through [decode]; a typed decode failure on the fresh value
 * surfaces as [Resource.Error] (never a thrown exception that would cancel the flow), and a failure
 * decoding a cached value degrades that slot to `null` so a schema-drifted cache can never brick
 * the network reload.
 *
 * The public-key read applies the web `usePushPublicKey` derivation BEFORE caching: the server
 * `{ publicKey }` is empty-coalesced via [pushPublicKeyValue], and a 404 / "not configured"
 * failure ([isPushUnconfigured]) is folded to a successful `null`-key wrapper rather than an error,
 * so the durable cache holds the SAME `null` the web hook returns for an unconfigured install. Any
 * OTHER failure (network, timeout, 5xx) propagates and surfaces as [Resource.Error].
 *
 * The two mutations call the API directly and return a non-throwing [Result]. They do NOT evict the
 * durable cache and do NOT invalidate the list (the web `useSubscribePush` / `useUnsubscribePush`
 * mutations invalidate ONLY `pushKeys.list` via the S8 store's targeted refresh). Bodies are
 * serialized to exact JSON bytes via [TextContent] for byte-for-byte parity with the web
 * `JSON.stringify` payloads. The DELETE answers 204, so its empty body is read as raw text and
 * discarded to avoid a spurious decode failure.
 */
public class HttpPushRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    PushRepository {
    override val domain: CacheDomain = CacheDomain.Push

    // ---- Reads --------------------------------------------------------------------

    override fun publicKey(): Flow<Resource<PushPublicKey>> =
        observe(pushPublicKeyKey(), PUSH_PUBLIC_KEY_TTL_MILLIS) { fetchPublicKeyElement() }
            .decode(PushPublicKey.serializer())

    override fun subscriptions(): Flow<Resource<List<PushSubscription>>> =
        observe(pushSubscriptionsKey(), PUSH_SUBSCRIPTIONS_TTL_MILLIS) {
            safeArray(api.request<JsonElement>(path = "/push/subscribe"))
        }.decode(ListSerializer(PushSubscription.serializer()))

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun subscribe(body: PushSubscribeBody): Result<PushSubscription> {
        val bytes = json.encodeToString(PushSubscribeBody.serializer(), body)
        return api.safeRequest<PushSubscription>(
            method = HttpMethodKind.POST,
            path = "/push/subscribe",
            body = TextContent(bytes, ContentType.Application.Json),
        )
    }

    override suspend fun unsubscribe(endpoint: String): Result<Unit> {
        val body = buildJsonObject { put("endpoint", endpoint) }
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        return api
            .safeRequest<String>(
                method = HttpMethodKind.DELETE,
                path = "/push/subscribe",
                body = jsonBody(body),
            ).map { }
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Fetches `GET /push/public-key`, applies the web `usePushPublicKey` derivation, and returns
     * the result as the cacheable [PushPublicKey] `{key}` element: a non-empty server key,
     * empty-coalesced to `null` ([pushPublicKeyValue]); a 404 / "not configured" failure
     * ([isPushUnconfigured]) is folded to a `null`-key wrapper (the web catch returning `null`).
     * Every OTHER failure is rethrown so `cacheThenNetwork` surfaces it as [Resource.Error].
     */
    private suspend fun fetchPublicKeyElement(): JsonElement {
        val derived =
            try {
                val response = api.request<PublicKeyResponse>(path = "/push/public-key")
                PushPublicKey(pushPublicKeyValue(response.publicKey))
            } catch (e: Throwable) {
                if (isPushUnconfigured(e)) PushPublicKey(null) else throw e
            }
        return json.encodeToJsonElement(PushPublicKey.serializer(), derived)
    }

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

    /** The raw `GET /push/public-key` envelope (`{ publicKey }`), decoded before derivation. */
    @Serializable
    private data class PublicKeyResponse(
        @SerialName("publicKey") val publicKey: String? = null,
    )
}
