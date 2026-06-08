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
import io.teslasync.shared.core.presentation.watch.WatchCommandResult
import io.teslasync.shared.core.presentation.watch.WatchComplication
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [WatchRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013). The
 * two reads share the single [CacheDomain.Watch] partition, keyed by a stable per-feed string
 * ([watchSummaryCacheKey]/[watchComplicationCacheKey]) that mirrors the web TanStack query keys, so each
 * feed caches independently while logout still clears the whole domain in one call.
 *
 * Because the domain has two distinct read shapes, the cache layer stores each feed's raw [JsonElement]
 * (the verbatim strategy of the Driving/Analytics ports) via [CachingRepository] of [JsonElement], and
 * each typed read decodes that element to its model on every emission through [decode]. Each read also
 * carries an explicit per-entry TTL override matching its web `staleTime` — the summary's
 * `STALE_TIMES.MODERATE` (15s, [WATCH_SUMMARY_TTL_MILLIS]) and the complication's `STALE_TIMES.FAST`
 * (30s, [WATCH_COMPLICATION_TTL_MILLIS]) — rather than a single lossy domain compromise.
 *
 * The command calls the API directly and returns a non-throwing [Result]; it evicts nothing because the
 * web `useWatchCommand` mutation invalidates no query on success (its `onSuccess` only raises a toast).
 * Its `{ vehicle_id, command }` body is serialized to exact JSON bytes via [TextContent] for
 * byte-for-byte parity with the web `JSON.stringify`. The web's `X-API-Key`/`skipAuthRefresh` transport
 * is a networking-layer concern wired at the platform boundary, not reproduced here. No Watch payload is
 * re-derived client-side, so each round-trips verbatim with no SI conversion.
 */
public class HttpWatchRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    WatchRepository {
    override val domain: CacheDomain = CacheDomain.Watch

    // ---- Reads --------------------------------------------------------------------

    override fun watchSummary(vehicleId: Long?): Flow<Resource<WatchSummary>> =
        observe(watchSummaryCacheKey(vehicleId), WATCH_SUMMARY_TTL_MILLIS) {
            api.request<JsonElement>(path = "/watch/summary", query = vehicleIdQuery(vehicleId))
        }.decode(WatchSummary.serializer())

    override fun watchComplication(vehicleId: Long?): Flow<Resource<WatchComplication>> =
        observe(watchComplicationCacheKey(vehicleId), WATCH_COMPLICATION_TTL_MILLIS) {
            api.request<JsonElement>(path = "/watch/complication", query = vehicleIdQuery(vehicleId))
        }.decode(WatchComplication.serializer())

    // ---- Command ------------------------------------------------------------------

    override suspend fun sendWatchCommand(
        vehicleId: Long?,
        command: String,
    ): Result<WatchCommandResult> =
        api.safeRequest<WatchCommandResult>(
            method = HttpMethodKind.POST,
            path = "/watch/command",
            body = jsonBody(watchCommandBody(vehicleId, command)),
        )

    // ---- Internals ----------------------------------------------------------------

    /**
     * Builds the optional `vehicle_id` query — present only for a non-null [vehicleId], mirroring the
     * web `vehicleId ? '?vehicle_id=…' : ''`; a null id sends no parameter at all.
     */
    private fun vehicleIdQuery(vehicleId: Long?): Map<String, String?> =
        vehicleId?.let { mapOf("vehicle_id" to it.toString()) } ?: emptyMap()

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
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach the
     * wire unchanged — byte-for-byte parity with the web `JSON.stringify` body.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
