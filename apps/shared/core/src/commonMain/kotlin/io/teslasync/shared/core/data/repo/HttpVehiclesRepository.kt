package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [VehiclesRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013) — the cross-platform port of the web `useVehicles` hook domain. Every read shares the
 * single [CacheDomain.VehicleInfo] partition, keyed by a stable per-feed string ([vehiclesKey] etc.)
 * that mirrors the web TanStack query keys, so a feed is cached independently while logout still
 * clears the whole domain in one call.
 *
 * Because the domain has many distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the verbatim-SI strategy of the Driving/Analytics ports) via [CachingRepository] of
 * [JsonElement], and each typed read decodes that element to its model on every emission: the list
 * and detail decode to the generated SI DTO [Vehicle], and [vehicleState] folds the raw response
 * into a [VehicleStateEnvelope] via [normalizeVehicleStateResponse] (the web `useVehicleState`
 * normalisation). List reads apply [safeArray] before the cache write — exactly the web
 * `select: safeArray`. A typed decode failure on a fresh value surfaces as [Resource.Error] (never a
 * thrown exception that would cancel the flow); a failure decoding a cached value degrades that slot
 * to `null` so a schema-drifted cache can never brick the network reload. The state normalisation
 * never throws, so its slots always carry a (possibly empty) envelope.
 *
 * Per-read web `staleTime`s are reproduced as TTLs: the list/detail/state/latest/positions feeds use
 * the domain's 30-second window (their web `staleTime` is 0 with `refetchInterval` polling), while
 * the info envelopes override per-entry (mobile-enabled SLOW, options/specs STATIC,
 * subscriptions/upgrades RARE, warranty DAILY). The ten mutations call the API directly and return a
 * non-throwing [Result]; they do NOT evict the durable cache — the cache-then-network operator
 * re-fetches when the S8 store bumps the affected family's triggers (the `invalidateQueries`
 * analogue), so the previous rows stay visible during the reload and no stale value is ever served as
 * fresh. Distances/speeds/temps/pressures stay SI through the cache; conversion is the render
 * boundary's job (S5).
 */
public class HttpVehiclesRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    VehiclesRepository {
    override val domain: CacheDomain = CacheDomain.VehicleInfo

    // ---- Reads --------------------------------------------------------------------

    override fun vehicles(): Flow<Resource<List<Vehicle>>> =
        observe(vehiclesKey(), VehiclesRepository.STALE_FAST_MS) {
            safeArray(api.request<JsonElement>(path = "/vehicles"))
        }.decode(ListSerializer(Vehicle.serializer()))

    override fun vehicle(id: String): Flow<Resource<Vehicle>> =
        observe(vehicleDetailKey(id)) {
            api.request<JsonElement>(path = "/vehicles/$id")
        }.decode(Vehicle.serializer())

    override fun vehicleState(
        vehicleId: Long,
        asOf: String?,
    ): Flow<Resource<VehicleStateEnvelope>> =
        observe(vehicleStateKey(vehicleId, asOf)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/state", query = vehicleStateQuery(asOf))
        }.mapState(vehicleId)

    override fun vehiclePositions(
        vehicleId: Long,
        limit: Int,
    ): Flow<Resource<JsonElement>> =
        observe(vehiclePositionsKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/vehicles/$vehicleId/positions", query = vehiclePositionsQuery(limit)))
        }

    override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(motorLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/motor/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun motorHistory(
        vehicleId: Long,
        limit: Int,
    ): Flow<Resource<JsonElement>> =
        observe(motorHistoryKey(vehicleId, limit)) {
            safeArray(api.request<JsonElement>(path = "/motor", query = motorHistoryQuery(vehicleId, limit)))
        }

    override fun driveDynamicsLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(driveDynamicsLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/drive-dynamics/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(climateLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/climate/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(securityLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/security/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun latestTirePressure(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(tirePressureLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/tire-pressure/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(chargingTelemetryLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/charging-telemetry/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun mediaLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(mediaLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/media/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun locationSnapshotLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(locationSnapshotLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/location-snapshots/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun vehicleConfigLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(vehicleConfigLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/vehicle-config/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun userPreferenceLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe(userPreferenceLatestKey(vehicleId)) {
            api.request<JsonElement>(path = "/user-preferences/latest", query = vehicleIdQuery(vehicleId))
        }

    override fun vehicleMobileEnabled(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(mobileEnabledKey(vehicleId), VehiclesRepository.STALE_SLOW_MS) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/mobile-enabled")
        }

    override fun vehicleOptions(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(vehicleOptionsKey(vehicleId), VehiclesRepository.STALE_STATIC_MS) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/options")
        }

    override fun vehicleSpecs(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(vehicleSpecsKey(vehicleId), VehiclesRepository.STALE_STATIC_MS) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/specs")
        }

    override fun vehicleSubscriptions(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(vehicleSubscriptionsKey(vehicleId), VehiclesRepository.STALE_RARE_MS) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/subscriptions")
        }

    override fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(vehicleUpgradesKey(vehicleId), VehiclesRepository.STALE_RARE_MS) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/upgrades")
        }

    override fun warrantyDetails(): Flow<Resource<JsonElement>> =
        observe(warrantyDetailsKey(), VehiclesRepository.STALE_DAILY_MS) {
            api.request<JsonElement>(path = "/tesla/warranty")
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun refreshVehicle(id: String): Result<Vehicle> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/$id/wake")

    override suspend fun deleteVehicle(id: Long): Result<Unit> =
        api.safeRequest<JsonElement>(method = HttpMethodKind.DELETE, path = "/vehicles/$id").map { }

    override suspend fun syncVehicles(): Result<JsonElement> = api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/sync")

    override suspend fun wakeVehicle(id: Long): Result<JsonElement> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/$id/wake")

    override suspend fun refreshVehicleMobileEnabled(id: String): Result<JsonElement> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/$id/mobile-enabled/refresh")

    override suspend fun refreshVehicleOptions(id: String): Result<JsonElement> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/$id/options/refresh")

    override suspend fun refreshVehicleSpecs(id: String): Result<JsonElement> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/$id/specs/refresh")

    override suspend fun refreshVehicleSubscriptions(id: String): Result<JsonElement> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/$id/subscriptions/refresh")

    override suspend fun refreshVehicleUpgrades(id: String): Result<JsonElement> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/vehicles/$id/upgrades/refresh")

    override suspend fun refreshWarrantyDetails(): Result<JsonElement> =
        api.safeRequest(method = HttpMethodKind.POST, path = "/tesla/warranty/refresh")

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
                    // A 2xx body that no longer matches the DTO is a contract error, not a transport
                    // one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /**
     * Maps a raw-JSON state feed onto a [VehicleStateEnvelope] via [normalizeVehicleStateResponse].
     * The normalisation never throws (it folds missing fields to the web defaults), so every slot —
     * cached or fresh — carries a (possibly empty) envelope.
     */
    private fun Flow<Resource<JsonElement>>.mapState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
        map { resource ->
            when (resource) {
                is Resource.Loading ->
                    Resource.Loading(
                        resource.cached?.let { normalizeVehicleStateResponse(it, vehicleId) },
                        resource.fetchedAt,
                        resource.stale,
                    )
                is Resource.Error ->
                    Resource.Error(
                        resource.cached?.let { normalizeVehicleStateResponse(it, vehicleId) },
                        resource.fetchedAt,
                        resource.stale,
                        resource.error,
                    )
                is Resource.Success ->
                    Resource.Success(
                        normalizeVehicleStateResponse(resource.data, vehicleId),
                        resource.fetchedAt,
                        resource.stale,
                    )
            }
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()
}
