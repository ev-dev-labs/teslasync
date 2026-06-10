package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverage
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverageRaw
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverageResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [FleetTelemetryRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013) — the data-layer port of the web `useFleetTelemetry` hook. The single coverage feed
 * lives in the [CacheDomain.FleetTelemetry] partition under the one stable key [COVERAGE_KEY]
 * (the snapshot is fleet-wide and parameterless, mirroring the web query key `['fleet-telemetry',
 * 'coverage']`); logout clears the whole domain in one call.
 *
 * The read goes through the generic cache-then-network operator ([observe]), which stores the raw
 * [JsonElement] verbatim (the same SI-faithful strategy as the Anomalies/Charging ports), so the
 * cached bytes round-trip unchanged. Each emission is then decoded to [FleetTelemetryCoverageRaw]
 * and run through the pure [FleetTelemetryCoverage.normalize] derivation — the port of the web
 * `queryFn`'s `?? []` / `?? {}` coalescing — yielding the guaranteed-non-null
 * [FleetTelemetryCoverageResponse].
 *
 * The web hook's `staleTime: STALE_TIMES.SLOW` (5 minutes) maps onto the domain's 5-minute
 * freshness window; the finer-grained refetch cadence is a UI concern (the S8/platform layer
 * chooses when to re-collect), mirroring how the web `staleTime` only gates the freshness flag, not
 * whether the cache-then-network refresh runs. There are no mutations — the web hook file has none
 * — so there is nothing to invalidate.
 *
 * Decode safety mirrors [HttpFeatureFlagsRepository]: a typed decode failure on the FRESH value
 * surfaces as [Resource.Error] (never a thrown exception that would cancel the flow before the next
 * refresh); a failure decoding a CACHED value degrades that slot to `null` so a schema-drifted
 * cache can never brick the network reload.
 */
public class HttpFleetTelemetryRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    FleetTelemetryRepository {
    override val domain: CacheDomain = CacheDomain.FleetTelemetry

    override fun coverage(): Flow<Resource<FleetTelemetryCoverageResponse>> =
        observe(COVERAGE_KEY) {
            api.request<JsonElement>(path = "/tesla/fleet-telemetry/coverage")
        }.map { it.toNormalized() }

    /**
     * Maps a raw-JSON cache-then-network emission onto the normalized coverage shape, guarding every
     * decode. The cached slot present on a Loading/Error emission is decoded best-effort (a drifted
     * cache degrades to `null`), while a fresh Success that fails to decode becomes an Error so the
     * stream survives to the next refresh.
     */
    private fun Resource<JsonElement>.toNormalized(): Resource<FleetTelemetryCoverageResponse> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryNormalize(it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryNormalize(it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { normalize(data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun tryNormalize(element: JsonElement): FleetTelemetryCoverageResponse? = runCatching { normalize(element) }.getOrNull()

    /** Decodes the raw envelope and applies the web `?? []` / `?? {}` coalescing derivation. */
    private fun normalize(element: JsonElement): FleetTelemetryCoverageResponse =
        FleetTelemetryCoverage.normalize(json.decodeFromJsonElement(FleetTelemetryCoverageRaw.serializer(), element))

    private companion object {
        // The single, parameterless feed key — the web query key `['fleet-telemetry','coverage']`.
        const val COVERAGE_KEY = "coverage"
    }
}
