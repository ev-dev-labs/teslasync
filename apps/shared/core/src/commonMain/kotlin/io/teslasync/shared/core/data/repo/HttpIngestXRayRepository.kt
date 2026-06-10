package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayBucket
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayResponse
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayWindow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [IngestXRayRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single read shares the [CacheDomain.IngestXRay] partition, keyed per
 * `(vehicleId, window, bucket, limit)` tuple by [ingestXRayKey] (mirroring the web TanStack query
 * key), so a distinct query is cached independently while logout still clears the whole domain in
 * one call.
 *
 * The read goes through the generic cache-then-network operator ([observe]), which stores the raw
 * [JsonElement] verbatim (the same SI-faithful strategy as the FleetTelemetry/Exports ports), so
 * the cached bytes round-trip unchanged. Each emission is then decoded to [IngestXRayResponse]. A
 * typed decode failure on the FRESH value surfaces as [Resource.Error] (never a thrown exception
 * that would cancel the flow before the next refresh); a failure decoding a CACHED value degrades
 * that slot to `null` so a schema-drifted cache can never brick the network reload.
 *
 * The web hook's `staleTime: STALE_TIMES.REALTIME` (5s) maps onto the domain's 5-second freshness
 * window; the finer-grained `refetchInterval` poll and the `enabled` lazy gate are UI concerns (the
 * S8/platform layer chooses when to re-collect). There are no mutations — the web hook file has none
 * — so there is nothing to invalidate.
 */
public class HttpIngestXRayRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    IngestXRayRepository {
    override val domain: CacheDomain = CacheDomain.IngestXRay

    override fun xray(
        vehicleId: Long,
        window: IngestXRayWindow,
        bucket: IngestXRayBucket,
        limit: Int,
    ): Flow<Resource<IngestXRayResponse>> =
        observe(ingestXRayKey(vehicleId, window, bucket, limit)) {
            api.request<JsonElement>(
                path = "/system/ingest-xray/$vehicleId",
                query = ingestXRayQuery(window, bucket, limit),
            )
        }.map { it.toTyped() }

    /**
     * Maps a raw-JSON cache-then-network emission onto the typed [IngestXRayResponse], guarding
     * every decode. The cached slot present on a Loading/Error emission is decoded best-effort (a
     * drifted cache degrades to `null`), while a fresh Success that fails to decode becomes an Error
     * so the stream survives to the next refresh.
     */
    private fun Resource<JsonElement>.toTyped(): Resource<IngestXRayResponse> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { decode(data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer matches the DTO is a contract error, not a
                    // transport one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun tryDecode(element: JsonElement): IngestXRayResponse? = runCatching { decode(element) }.getOrNull()

    private fun decode(element: JsonElement): IngestXRayResponse = json.decodeFromJsonElement(IngestXRayResponse.serializer(), element)
}
