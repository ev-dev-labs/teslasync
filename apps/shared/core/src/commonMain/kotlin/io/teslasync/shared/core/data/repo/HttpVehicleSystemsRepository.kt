package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [VehicleSystemsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.VehicleSystems] partition, keyed by a stable
 * per-feed string ([climateKey] etc.) that mirrors the web `vehicleSystemsKeys` tuples, so each feed
 * is cached independently while logout still clears the whole domain in one call.
 *
 * Because the domain has many distinct read shapes with no generated DTO, the cache layer stores
 * each feed's raw [JsonElement] (the verbatim-SI strategy of the Driving/Analytics ports) via
 * [CachingRepository] of [JsonElement]. The six list reads (every history feed plus the
 * maintenance/service-record/software-update lists) apply [safeArray] before the cache write —
 * exactly the web `select: safeArray` derivation, performed once at the data layer; the four
 * "latest" snapshots are object reads carried verbatim.
 *
 * Freshness mirrors the web `staleTime` intent: the four "latest" reads and the history /
 * software-update reads use the [CacheDomain.VehicleSystems] 30-second default window, while the
 * global `useMaintenance`/`useServiceRecords` catalogs (web `STALE_TIMES.STATIC`) carry the explicit
 * [VEHICLE_SYSTEMS_STATIC_TTL_MILLIS] never-stale per-entry TTL. The `useSoftwareUpdates` read sends
 * NO `vehicle_id` query param (the bare `/software-updates`), matching the web request, yet is cached
 * per-vehicle. The web hook file declares no mutations, so this repository has no write surface.
 * Temps/pressures/ranges stay SI (°C, Pa, meters) through the cache; conversion is the render
 * boundary's job (S5).
 */
public class HttpVehicleSystemsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    VehicleSystemsRepository {
    override val domain: CacheDomain = CacheDomain.VehicleSystems

    // ---- Climate ------------------------------------------------------------------

    override fun climate(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(climateKey(vehicleId)) {
            api.request<JsonElement>(path = "/climate/latest", query = vehicleSystemsVehicleIdQuery(vehicleId))
        }

    override fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(climateHistoryKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/climate", query = vehicleSystemsVehicleIdQuery(vehicleId)))
        }

    // ---- Tire pressure ------------------------------------------------------------

    override fun tirePressure(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(tirePressureKey(vehicleId)) {
            api.request<JsonElement>(path = "/tire-pressure/latest", query = vehicleSystemsVehicleIdQuery(vehicleId))
        }

    override fun tirePressureHistory(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(tirePressureHistoryKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/tire-pressure", query = vehicleSystemsVehicleIdQuery(vehicleId)))
        }

    // ---- Maintenance (global, STATIC) ---------------------------------------------

    override fun maintenance(): Flow<Resource<JsonElement>> =
        observe(maintenanceKey(), VEHICLE_SYSTEMS_STATIC_TTL_MILLIS) {
            safeArray(api.request<JsonElement>(path = "/maintenance"))
        }

    override fun serviceRecords(): Flow<Resource<JsonElement>> =
        observe(serviceRecordsKey(), VEHICLE_SYSTEMS_STATIC_TTL_MILLIS) {
            safeArray(api.request<JsonElement>(path = "/maintenance/records"))
        }

    // ---- Software updates (keyed per-vehicle, unparameterised request) ------------

    override fun softwareUpdates(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(softwareUpdatesKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/software-updates"))
        }

    // ---- Safety -------------------------------------------------------------------

    override fun safety(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(safetyKey(vehicleId)) {
            api.request<JsonElement>(path = "/safety/latest", query = vehicleSystemsVehicleIdQuery(vehicleId))
        }

    override fun safetyHistory(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(safetyHistoryKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/safety", query = vehicleSystemsVehicleIdQuery(vehicleId)))
        }

    // ---- Media --------------------------------------------------------------------

    override fun media(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(mediaKey(vehicleId)) {
            api.request<JsonElement>(path = "/media/latest", query = vehicleSystemsVehicleIdQuery(vehicleId))
        }

    override fun mediaHistory(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(mediaHistoryKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/media", query = vehicleSystemsVehicleIdQuery(vehicleId)))
        }
}
