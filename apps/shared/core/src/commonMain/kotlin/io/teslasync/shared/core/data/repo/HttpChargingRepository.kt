package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.charging.ApplyScheduleInput
import io.teslasync.shared.core.presentation.charging.OptimizeChargeInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [ChargingRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.Charging] partition, keyed by a stable
 * per-feed string ([chargingSessionsKey] etc.) that mirrors the web TanStack query keys, so a
 * feed is cached independently while logout still clears the whole domain in one call.
 *
 * Because the domain has several distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the verbatim-SI strategy of the Automations/Admin ports) via
 * [CachingRepository] of [JsonElement], and each typed read decodes that element to its model on
 * every emission through [decode]. List reads apply [safeArray] before the cache write — exactly
 * the web `select: safeArray` derivation, performed once at the data layer. A typed decode
 * failure on the fresh value surfaces as [Resource.Error] (never a thrown exception that would
 * cancel the flow before the next refresh); a failure decoding a cached value degrades that slot
 * to `null` so a schema-drifted cache can never brick the network reload.
 *
 * The five mutations call the API directly and return a non-throwing [Result]. They do NOT evict
 * the durable cache: the cache-then-network operator always re-fetches when the S8 store bumps
 * the affected family's triggers (the `invalidateQueries` analogue), so the previous rows stay
 * visible during the reload — exactly the web behaviour of keeping prior data while a refetch is
 * in flight — and no stale value is ever served as fresh. Energy/power stay SI (Wh, W) through
 * the cache; conversion is the render boundary's job (S5).
 */
public class HttpChargingRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    ChargingRepository {
    override val domain: CacheDomain = CacheDomain.Charging

    // ---- Reads --------------------------------------------------------------------

    override fun sessions(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
        observe(chargingSessionsKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/charging-sessions", query = chargingSessionsQuery(vehicleId)))
        }.decode(ListSerializer(ChargingSession.serializer()))

    override fun session(id: String): Flow<Resource<ChargingSession>> =
        observe(chargingSessionDetailKey(id)) { api.request<JsonElement>(path = "/charging/$id") }
            .decode(ChargingSession.serializer())

    override fun sessionDetail(id: Long): Flow<Resource<ChargingSession>> =
        observe(chargingSessionByIdKey(id)) { api.request<JsonElement>(path = "/charging/$id") }
            .decode(ChargingSession.serializer())

    override fun chargeTelemetry(sessionId: Long): Flow<Resource<List<ChargeTelemetryReading>>> =
        observe(chargeTelemetryKey(sessionId)) {
            safeArray(api.request<JsonElement>(path = "/charging/$sessionId/telemetry"))
        }.decode(ListSerializer(ChargeTelemetryReading.serializer()))

    override fun sessionsPaginated(
        vehicleId: Long,
        limit: Int,
        offset: Int,
        start: String?,
        end: String?,
    ): Flow<Resource<List<ChargingSession>>> =
        observe(chargingPaginatedKey(vehicleId, start, end, limit, offset)) {
            safeArray(
                api.request<JsonElement>(
                    path = "/charging",
                    query = chargingPaginatedQuery(vehicleId, limit, offset, start, end),
                ),
            )
        }.decode(ListSerializer(ChargingSession.serializer()))

    override fun costForecast(
        vehicleId: String,
        months: Int,
    ): Flow<Resource<JsonElement>> =
        observe(costForecastKey(vehicleId, months)) {
            api.request<JsonElement>(path = "/analytics/cost-forecast", query = costForecastQuery(vehicleId, months))
        }

    override fun chargingOptimizer(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(chargingOptimizerKey(vehicleId)) {
            api.request<JsonElement>(path = "/analytics/charging-optimizer", query = chargingOptimizerQuery(vehicleId))
        }

    override fun teslaChargingHistory(vin: String?): Flow<Resource<JsonElement>> =
        observe(teslaChargingHistoryKey(vin)) {
            api.request<JsonElement>(path = "/tesla/charging/history", query = teslaVinQuery(vin))
        }

    override fun teslaChargingSessions(vin: String?): Flow<Resource<JsonElement>> =
        observe(teslaChargingSessionsKey(vin)) {
            api.request<JsonElement>(path = "/tesla/charging/sessions", query = teslaVinQuery(vin))
        }

    override fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(chargePlansKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/charge-planner/history", query = chargePlansQuery(vehicleId)))
        }

    override fun ratePlans(): Flow<Resource<JsonElement>> =
        observe(ratePlansKey()) {
            safeArray(api.request<JsonElement>(path = "/charge-planner/rate-plans"))
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun refreshTeslaChargingHistory(
        vin: String?,
        startTime: String?,
        endTime: String?,
    ): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/tesla/charging/history/refresh",
            query = teslaHistoryRefreshQuery(vin, startTime, endTime),
        )

    override suspend fun refreshTeslaChargingSessions(
        vin: String?,
        dateFrom: String?,
        dateTo: String?,
    ): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/tesla/charging/sessions/refresh",
            query = teslaSessionsRefreshQuery(vin, dateFrom, dateTo),
        )

    override suspend fun optimizeCharge(input: OptimizeChargeInput): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/charge-planner/optimize",
            body = inputBody(OptimizeChargeInput.serializer(), input),
        )

    override suspend fun applySchedule(input: ApplyScheduleInput): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/charge-planner/apply",
            body = inputBody(ApplyScheduleInput.serializer(), input),
        )

    override suspend fun bulkDeleteCharging(ids: List<Long>): Result<JsonElement> {
        val body = buildJsonObject { put("ids", JsonArray(ids.map { JsonPrimitive(it) })) }
        return api.safeRequest<JsonElement>(
            method = HttpMethodKind.DELETE,
            path = "/charging/bulk",
            body = jsonBody(body),
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
     * Serializes a typed input into its exact create body bytes — byte-for-byte parity with the
     * web `JSON.stringify(input)` (nulls dropped via the client JSON's `explicitNulls = false`).
     */
    private fun <T> inputBody(
        serializer: KSerializer<T>,
        input: T,
    ): TextContent = TextContent(json.encodeToString(serializer, input), ContentType.Application.Json)

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
