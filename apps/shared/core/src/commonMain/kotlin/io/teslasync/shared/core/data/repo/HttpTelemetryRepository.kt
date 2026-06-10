package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotResponse
import io.teslasync.shared.core.presentation.telemetry.SignalStats
import io.teslasync.shared.core.presentation.telemetry.TelemetryDerivations
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [TelemetryRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The fourteen reads share the single [CacheDomain.Telemetry] partition, keyed by a stable
 * per-feed string (the `telemetry*Key` builders) that mirrors the web `telemetryKeys` tuples, so each
 * feed is cached independently while logout still clears the whole domain in one call. Each read
 * overrides the domain-default TTL with its web-faithful `staleTime`
 * ([TELEMETRY_REALTIME_TTL_MILLIS]/[TELEMETRY_SLOW_TTL_MILLIS]/[TELEMETRY_STANDARD_TTL_MILLIS]).
 *
 * The cache stores each feed's RAW server [JsonElement] (verbatim SI), exactly the strategy of the
 * Signals/Analytics ports, via [CachingRepository] of [JsonElement]. The decode-or-derive step the
 * web hooks do in their `queryFn`/`select` is applied per emission by [mapData]: plain reads decode
 * the cached element into the typed model, and the four non-trivial reads run the pure
 * [TelemetryDerivations] transforms (signal names, live-gaps map, observation adapter, MQTT-status
 * normalization) shared with the C# port. A transform failure on the fresh value surfaces as
 * [Resource.Error] (never a thrown exception that would cancel the flow before the next refresh); a
 * failure on a cached value degrades that slot to `null` so a schema-drifted cache can never brick
 * the reload.
 *
 * The two refresh mutations POST and, on success, leave the durable cache intact — the S8 store
 * mirrors the web `invalidateQueries` by re-collecting only the affected family of feeds, and
 * `cacheThenNetwork` always hits the network on refresh so no stale value is ever served as fresh.
 * Values stay SI through the cache; conversion is the render boundary's job (S5).
 */
public class HttpTelemetryRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    TelemetryRepository {
    override val domain: CacheDomain = CacheDomain.Telemetry

    // ---- Reads --------------------------------------------------------------------

    override fun signals(vehicleId: Long): Flow<Resource<List<String>>> =
        observe(telemetrySignalsKey(vehicleId), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/$vehicleId/available")
        }.mapData { TelemetryDerivations.signalNames(it) }

    override fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>> =
        observe(telemetryLiveSignalsKey(vehicleId), TELEMETRY_REALTIME_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/$vehicleId/live")
        }.mapData { decode(VehicleLiveSignalsResponse.serializer(), it) }

    override fun signalStats(vehicleId: Long): Flow<Resource<SignalStats>> =
        observe(telemetrySignalStatsKey(vehicleId), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/$vehicleId/stats")
        }.mapData { decode(SignalStats.serializer(), it) }

    override fun signalHistory(
        vehicleId: Long,
        signal: String,
        hours: Int,
    ): Flow<Resource<SignalHistoryResponse>> =
        observe(telemetrySignalHistoryKey(vehicleId, signal, hours), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(
                path = "/signals/$vehicleId/$signal/history",
                query = telemetrySignalHistoryQuery(hours),
            )
        }.mapData { decode(SignalHistoryResponse.serializer(), it) }

    override fun signalLog(
        vehicleId: Long,
        signal: String,
        hours: Int,
        page: Int,
        pageSize: Int,
    ): Flow<Resource<SignalHistoryResponse>> =
        observe(telemetrySignalLogKey(vehicleId, signal, hours, page), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(
                path = "/signals/$vehicleId/$signal/history",
                query = telemetrySignalLogQuery(hours, page, pageSize),
            )
        }.mapData { decode(SignalHistoryResponse.serializer(), it) }

    override fun signalDiff(
        vehicleId: Long,
        signal: String,
        from: String,
        to: String,
    ): Flow<Resource<SignalHistoryResponse>> =
        observe(telemetrySignalDiffKey(vehicleId, signal, from, to), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(
                path = "/signals/$vehicleId/$signal/history",
                query = telemetrySignalDiffQuery(from, to),
            )
        }.mapData { decode(SignalHistoryResponse.serializer(), it) }

    override fun signalSnapshot(
        vehicleId: Long,
        at: String,
        signalsCsv: String,
    ): Flow<Resource<SignalSnapshotResponse>> =
        observe(telemetrySignalSnapshotKey(vehicleId, at, signalsCsv), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(
                path = "/signals/$vehicleId/snapshot",
                query = telemetrySnapshotQuery(at, signalsCsv),
            )
        }.mapData { decode(SignalSnapshotResponse.serializer(), it) }

    override fun signalDiffServer(
        vehicleId: Long,
        atA: String,
        atB: String,
        signalsCsv: String,
    ): Flow<Resource<SignalDiffServerResponse>> =
        observe(telemetrySignalDiffServerKey(vehicleId, atA, atB, signalsCsv), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(
                path = "/signals/$vehicleId/diff",
                query = telemetryDiffServerQuery(atA, atB, signalsCsv),
            )
        }.mapData { decode(SignalDiffServerResponse.serializer(), it) }

    override fun signalGaps(vehicleId: Long): Flow<Resource<Map<String, JsonElement>>> =
        observe(telemetrySignalGapsKey(vehicleId), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/$vehicleId/live")
        }.mapData { TelemetryDerivations.signalGaps(it) }

    override fun mqttStatus(): Flow<Resource<TelemetryStatus>> =
        observe(TELEMETRY_MQTT_STATUS_KEY, TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(path = "/telemetry")
        }.mapData { TelemetryDerivations.normalizeMqttStatus(it) }

    override fun signalCatalog(): Flow<Resource<List<SignalCatalogEntry>>> =
        observe(TELEMETRY_SIGNAL_CATALOG_KEY, TELEMETRY_SLOW_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/catalog")
        }.mapData { decode(ListSerializer(SignalCatalogEntry.serializer()), it) }

    override fun signalObservations(params: SignalObservationsParams): Flow<Resource<List<SignalObservation>>> =
        observe(telemetrySignalObservationsKey(params), TELEMETRY_REALTIME_TTL_MILLIS) {
            api.request<JsonElement>(path = "/signals/observations", query = telemetryObservationsQuery(params))
        }.mapData { TelemetryDerivations.adaptObservations(it) }

    override fun fleetTelemetryErrorVINs(): Flow<Resource<List<FleetTelemetryErrorVIN>>> =
        observe(TELEMETRY_ERROR_VINS_KEY, TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(path = "/tesla/fleet-telemetry/error-vins")
        }.mapData { decode(ListSerializer(FleetTelemetryErrorVIN.serializer()), it) }

    override fun fleetTelemetryErrors(vin: String?): Flow<Resource<List<FleetTelemetryError>>> =
        observe(telemetryErrorsKey(vin), TELEMETRY_STANDARD_TTL_MILLIS) {
            api.request<JsonElement>(path = "/tesla/fleet-telemetry/errors", query = telemetryErrorsQuery(vin))
        }.mapData { decode(ListSerializer(FleetTelemetryError.serializer()), it) }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun refreshFleetTelemetryErrorVINs(): Result<Unit> =
        api
            .safeRequest<String>(method = HttpMethodKind.POST, path = "/tesla/fleet-telemetry/error-vins/refresh")
            .map { }

    override suspend fun refreshFleetTelemetryErrors(): Result<Unit> =
        api
            .safeRequest<String>(method = HttpMethodKind.POST, path = "/tesla/fleet-telemetry/errors/refresh")
            .map { }

    // ---- Internals ----------------------------------------------------------------

    private fun <T> decode(
        serializer: kotlinx.serialization.KSerializer<T>,
        element: JsonElement,
    ): T = json.decodeFromJsonElement(serializer, element)

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
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryTransform(
        transform: (JsonElement) -> T,
        element: JsonElement,
    ): T? = runCatching { transform(element) }.getOrNull()
}
