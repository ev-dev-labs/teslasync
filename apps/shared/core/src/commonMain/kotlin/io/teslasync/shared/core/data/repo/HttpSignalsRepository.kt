package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalHistoryRange
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [SignalsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The three reads share the single [CacheDomain.Signals] partition, keyed by a stable
 * per-feed string ([signalsAvailableKey] etc.) that mirrors the web `signalKeys` tuples, so each
 * feed is cached independently while logout still clears the whole domain in one call. Each read
 * overrides the domain-default TTL with its web-faithful `staleTime`
 * ([SIGNALS_AVAILABLE_TTL_MILLIS]/[SIGNALS_LIVE_TTL_MILLIS]/[SIGNALS_HISTORY_TTL_MILLIS]).
 *
 * The cache stores each feed's RAW server [JsonElement] (verbatim SI), exactly the strategy of the
 * Driving/Analytics ports, via [CachingRepository] of [JsonElement]. The ValueKind/UnitKind
 * normalization the web hooks do in their `queryFn` is applied per emission by [mapData] — using the
 * pure derivations in [SignalsRepository.kt] ([normalizeAvailableResponse] etc.) — so the typed read
 * model is produced from the cached raw element on every emission and the C#/KMP ports share the
 * golden-locked transform. A normalization failure on the fresh value surfaces as [Resource.Error]
 * (never a thrown exception that would cancel the flow before the next refresh); a failure on a
 * cached value degrades that slot to `null` so a schema-drifted cache can never brick the reload.
 *
 * The domain is read-only — the web hook file declares no mutations — so this repository exposes no
 * write path. Values stay SI through the cache; conversion is the render boundary's job (S5).
 */
public class HttpSignalsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    SignalsRepository {
    override val domain: CacheDomain = CacheDomain.Signals

    override fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>> =
        observe(signalsAvailableKey(vehicleId), SIGNALS_AVAILABLE_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/$vehicleId/available")
        }.mapData(::normalizeAvailableResponse)

    override fun liveSignals(vehicleId: Long): Flow<Resource<LiveSignalsResponse>> =
        observe(signalsLiveKey(vehicleId), SIGNALS_LIVE_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/$vehicleId/live")
        }.mapData(::normalizeLiveResponse)

    override fun signalHistory(
        vehicleId: Long,
        signalName: String,
        range: SignalHistoryRange,
    ): Flow<Resource<SignalHistoryResponse>> =
        observe(signalsHistoryKey(vehicleId, signalName, range), SIGNALS_HISTORY_TTL_MILLIS) {
            api.request<JsonElement>(
                path = "/signals/$vehicleId/$signalName/history",
                query = signalHistoryQuery(range),
            )
        }.mapData(::normalizeHistoryResponse)

    // ---- Internals ----------------------------------------------------------------

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every transform. */
    private fun <T> Flow<Resource<JsonElement>>.mapData(transform: (JsonElement) -> T): Flow<Resource<T>> =
        map { resource -> resource.mapTo(transform) }

    private fun <T> Resource<JsonElement>.mapTo(transform: (JsonElement) -> T): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryTransform(transform, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryTransform(transform, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { transform(data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer normalizes is a contract error, not a transport one —
                    // surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryTransform(
        transform: (JsonElement) -> T,
        element: JsonElement,
    ): T? = runCatching { transform(element) }.getOrNull()
}
