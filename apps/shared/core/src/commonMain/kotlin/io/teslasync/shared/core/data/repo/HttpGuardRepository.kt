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
import io.teslasync.shared.core.presentation.guard.AcknowledgeResponse
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEventsResponse
import io.teslasync.shared.core.presentation.guard.PanicResponse
import io.teslasync.shared.core.presentation.guard.SetConfigResponse
import io.teslasync.shared.core.presentation.guard.SetGuardConfigInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [GuardRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The two reads share the single [CacheDomain.Guard] partition under distinct prefixed
 * keys — [guardConfigKey] / [guardEventsKey], mirroring the web `guardKeys.config` /
 * `guardKeys.events` query keys — so each vehicle's config and events cache independently while
 * logout still clears the whole domain in one call.
 *
 * Because the domain has two distinct read shapes ([GuardConfig] and the [GuardEventsResponse]
 * envelope), the cache layer stores each feed's raw [JsonElement] (the same verbatim-SI strategy as
 * the Chat/Admin ports) via [CachingRepository] of [JsonElement], and each read decodes that element
 * to its typed model on every emission through [decode]. A typed decode failure on the fresh value
 * surfaces as [Resource.Error] (never a thrown exception that would cancel the flow before the next
 * refresh); a failure decoding a cached value degrades that slot to `null` so a schema-drifted cache
 * can never brick the network reload.
 *
 * The three mutations call the API directly and do NOT touch the cache: invalidation is the S8
 * store's targeted refresh (the web `invalidateQueries` analogue), and the cache-then-network
 * operator always re-fetches on refresh, so the last-known value stays visible during the reload and
 * no stale value is ever served as fresh.
 */
public class HttpGuardRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    GuardRepository {
    override val domain: CacheDomain = CacheDomain.Guard

    // ---- Reads --------------------------------------------------------------------

    override fun guardConfig(vehicleId: String): Flow<Resource<GuardConfig>> =
        observe(guardConfigKey(vehicleId)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/guard")
        }.decode(GuardConfig.serializer())

    override fun guardEvents(vehicleId: String): Flow<Resource<GuardEventsResponse>> =
        observe(guardEventsKey(vehicleId)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/guard/events")
        }.decode(GuardEventsResponse.serializer())

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun setGuardConfig(input: SetGuardConfigInput): Result<SetConfigResponse> {
        val body =
            buildJsonObject {
                put("enabled", input.enabled)
                // Web `JSON.stringify` carries an explicit `null` for a missing fence, not a dropped key.
                put("home_geofence_id", input.homeGeofenceId)
                put("sensitivity", input.sensitivity)
                put("auto_panic", input.autoPanic)
            }
        return api.safeRequest<SetConfigResponse>(
            method = HttpMethodKind.POST,
            path = "/vehicles/${input.vehicleId}/guard",
            body = jsonBody(body),
        )
    }

    override suspend fun triggerPanic(vehicleId: String): Result<PanicResponse> =
        api.safeRequest<PanicResponse>(
            method = HttpMethodKind.POST,
            path = "/vehicles/$vehicleId/guard/panic",
        )

    override suspend fun acknowledgeGuardEvent(
        vehicleId: String,
        eventId: Long,
    ): Result<AcknowledgeResponse> =
        api.safeRequest<AcknowledgeResponse>(
            method = HttpMethodKind.POST,
            path = "/vehicles/$vehicleId/guard/events/$eventId/acknowledge",
        )

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
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
