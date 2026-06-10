package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.driving.TripPlanRequest
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
 * HTTP-backed [DrivingRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.Drives] partition, keyed by a stable
 * per-feed string ([drivesKey] etc.) that mirrors the web TanStack query keys, so a feed is cached
 * independently while logout still clears the whole domain in one call.
 *
 * Because the domain has many distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the verbatim-SI strategy of the Analytics/Charging ports) via
 * [CachingRepository] of [JsonElement], and each typed read decodes that element to its model on
 * every emission through [decode]. The `drives` list decodes to the generated SI DTO [Drive] and
 * the per-drive telemetry to [DriveTelemetryReading]; every other read stays a raw [JsonElement].
 * List reads apply [safeArray] before the cache write — exactly the web `select: safeArray`
 * derivation, performed once at the data layer. A typed decode failure on the fresh value surfaces
 * as [Resource.Error] (never a thrown exception that would cancel the flow before the next
 * refresh); a failure decoding a cached value degrades that slot to `null` so a schema-drifted
 * cache can never brick the network reload.
 *
 * The two mutations call the API directly and return a non-throwing [Result]. They do NOT evict
 * the durable cache: the cache-then-network operator always re-fetches when the S8 store bumps the
 * affected family's triggers (the `invalidateQueries` analogue), so the previous rows stay visible
 * during the reload — exactly the web behaviour of keeping prior data while a refetch is in
 * flight — and no stale value is ever served as fresh. Distances/speeds/energy stay SI (meters,
 * m/s, Wh, W) through the cache; conversion is the render boundary's job (S5).
 */
public class HttpDrivingRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    DrivingRepository {
    override val domain: CacheDomain = CacheDomain.Drives

    // ---- Reads --------------------------------------------------------------------

    override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> =
        observe(drivesKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/drives/", query = driveVehicleIdQuery(vehicleId)))
        }.decode(ListSerializer(Drive.serializer()))

    override fun drive(id: String): Flow<Resource<JsonElement>> =
        observe(driveDetailKey(id)) { api.request<JsonElement>(path = "/drives/$id/") }

    override fun driveScore(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(driveScoreKey(vehicleId)) {
            api.request<JsonElement>(path = "/drives/score", query = driveVehicleIdQuery(vehicleId))
        }

    override fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(drivingStatsKey(vehicleId)) {
            api.request<JsonElement>(path = "/drives/stats", query = driveVehicleIdQuery(vehicleId))
        }

    override fun drivingDynamics(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(drivingDynamicsKey(vehicleId)) {
            api.request<JsonElement>(path = "/drives/dynamics", query = driveVehicleIdQuery(vehicleId))
        }

    override fun accelerationDistribution(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(accelerationDistributionKey(vehicleId)) {
            api.request<JsonElement>(path = "/drives/acceleration-distribution", query = driveVehicleIdQuery(vehicleId))
        }

    override fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(drivetrainHealthKey(vehicleId)) {
            api.request<JsonElement>(path = "/drivetrain/health", query = driveVehicleIdQuery(vehicleId))
        }

    override fun speedProfile(
        vehicleId: String,
        start: String?,
        end: String?,
    ): Flow<Resource<JsonElement>> =
        observe(speedProfileKey(vehicleId, start, end)) {
            api.request<JsonElement>(path = "/analytics/speed-profile", query = driveAnalyticsRangeQuery(vehicleId, start, end))
        }

    override fun regenEfficiency(
        vehicleId: String,
        start: String?,
        end: String?,
    ): Flow<Resource<JsonElement>> =
        observe(regenEfficiencyKey(vehicleId, start, end)) {
            api.request<JsonElement>(path = "/analytics/regen", query = driveAnalyticsRangeQuery(vehicleId, start, end))
        }

    override fun routeEfficiency(
        vehicleId: String,
        start: String?,
        end: String?,
    ): Flow<Resource<JsonElement>> =
        observe(routeEfficiencyKey(vehicleId, start, end)) {
            api.request<JsonElement>(path = "/analytics/route-efficiency", query = driveAnalyticsRangeQuery(vehicleId, start, end))
        }

    override fun drivePositions(driveId: String): Flow<Resource<JsonElement>> =
        observe(drivePositionsKey(driveId)) {
            safeArray(api.request<JsonElement>(path = "/drives/$driveId/positions"))
        }

    override fun driveTelemetry(driveId: String): Flow<Resource<List<DriveTelemetryReading>>> =
        observe(driveTelemetryKey(driveId)) {
            safeArray(api.request<JsonElement>(path = "/drives/$driveId/telemetry"))
        }.decode(ListSerializer(DriveTelemetryReading.serializer()))

    override fun drivingCoach(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> =
        observe(drivingCoachKey(vehicleId, days)) {
            api.request<JsonElement>(path = "/analytics/driving-coach", query = drivingCoachQuery(vehicleId, days))
        }

    override fun geocodeSearch(query: String): Flow<Resource<JsonElement>> =
        observe(geocodeSearchKey(query)) {
            safeArray(api.request<JsonElement>(path = "/geocode/search", query = geocodeSearchQuery(query)))
        }

    override fun driveWhyEnded(
        driveId: String,
        window: String,
    ): Flow<Resource<JsonElement>> =
        observe(driveWhyEndedKey(driveId, window)) {
            api.request<JsonElement>(path = "/drives/$driveId/why-ended", query = driveWhyEndedQuery(window))
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun planTrip(input: TripPlanRequest): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/trip-planner/plan",
            body = inputBody(TripPlanRequest.serializer(), input),
        )

    override suspend fun bulkDeleteDrives(ids: List<Long>): Result<JsonElement> {
        val body = buildJsonObject { put("ids", JsonArray(ids.map { JsonPrimitive(it) })) }
        return api.safeRequest<JsonElement>(
            method = HttpMethodKind.DELETE,
            path = "/drives/bulk",
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
