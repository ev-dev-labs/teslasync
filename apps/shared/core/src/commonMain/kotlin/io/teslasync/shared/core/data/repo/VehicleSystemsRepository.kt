package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the VehicleSystems domain — the cross-platform analogue of the web
 * `useVehicleSystems` hook domain (web/src/api/hooks/useVehicleSystems.ts). Every native
 * VehicleSystems surface (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * The eleven reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. Each is cached under a stable per-feed key (see
 * [climateKey] etc.) mirroring the web `vehicleSystemsKeys` tuples. Because none of these shapes
 * (climate snapshot, tire-pressure reading, maintenance item, service record, software update,
 * safety snapshot, media snapshot, and their history lists) has a generated DTO, every read is
 * carried verbatim as a raw SI [JsonElement] — the same strategy as the Driving/Analytics ports.
 * The six list reads (every history feed plus the maintenance/service-record/software-update lists)
 * apply the `safeArray` guard before the cache write — exactly the web `select: safeArray`
 * derivation, performed once at the data layer.
 *
 * The web hook file declares NO mutations, so this port has no write surface and no invalidation
 * family: refreshes are platform pull-to-refresh re-collections of the cache-then-network feed,
 * which always re-fetches while replaying the last cached value first.
 *
 * Per-feed staleTime intent from the web hooks: the four "latest" reads
 * (`useClimate`/`useTirePressure`/`useSafety`/`useMedia`) poll `INTERVALS.STANDARD` (30s) via
 * `refetchInterval` and the history / software-update reads use the default TanStack `staleTime`
 * (0); the [io.teslasync.shared.core.cache.CacheDomain.VehicleSystems] 30-second window keeps the
 * freshness flag honest for all of those. The global `useMaintenance`/`useServiceRecords` catalogs
 * read with `STALE_TIMES.STATIC` (never stale), so those two feeds carry the explicit
 * [VEHICLE_SYSTEMS_STATIC_TTL_MILLIS] per-entry TTL override instead of the domain window.
 *
 * The web `enabled: !!vehicleId` lazy gates on the per-vehicle reads are render-layer concerns and
 * are NOT reproduced here. Temps/pressures/ranges stay SI on the wire (°C, Pa, meters) and through
 * the cache; display conversion is the render boundary's job (S5), never this layer's.
 */
public interface VehicleSystemsRepository {
    /**
     * `GET /climate/latest?vehicle_id={vehicleId}` — the vehicle's latest climate snapshot
     * (web `useClimate`). Carried as raw SI [JsonElement]. Cached under [climateKey].
     */
    public fun climate(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /climate?vehicle_id={vehicleId}` — the vehicle's climate history (web `useClimateHistory`,
     * `safeArray`-guarded). Carried as a raw SI [JsonElement] array. Cached under [climateHistoryKey].
     */
    public fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /tire-pressure/latest?vehicle_id={vehicleId}` — the latest tire-pressure reading
     * (web `useTirePressure`). Carried as raw SI [JsonElement]. Cached under [tirePressureKey].
     */
    public fun tirePressure(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /tire-pressure?vehicle_id={vehicleId}` — the tire-pressure history (web
     * `useTirePressureHistory`, `safeArray`-guarded). Cached under [tirePressureHistoryKey].
     */
    public fun tirePressureHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /maintenance` — the deployment-static maintenance-schedule catalog (web `useMaintenance`,
     * `safeArray`-guarded, `STALE_TIMES.STATIC`). Takes no params. Cached under [maintenanceKey] with
     * the [VEHICLE_SYSTEMS_STATIC_TTL_MILLIS] never-stale TTL.
     */
    public fun maintenance(): Flow<Resource<JsonElement>>

    /**
     * `GET /maintenance/records` — the service-record catalog (web `useServiceRecords`,
     * `safeArray`-guarded, `STALE_TIMES.STATIC`). Takes no params. Cached under [serviceRecordsKey]
     * with the [VEHICLE_SYSTEMS_STATIC_TTL_MILLIS] never-stale TTL.
     */
    public fun serviceRecords(): Flow<Resource<JsonElement>>

    /**
     * `GET /software-updates` — the software-update list (web `useSoftwareUpdates`,
     * `safeArray`-guarded). The web request sends NO `vehicle_id` query param even though the hook is
     * keyed by `vehicleId` (its `enabled: !!vehicleId` gate is a render-layer concern), so this read
     * is cached per-vehicle under [softwareUpdatesKey] while issuing an unparameterised request.
     */
    public fun softwareUpdates(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /safety/latest?vehicle_id={vehicleId}` — the latest safety snapshot (web `useSafety`).
     * Carried as raw SI [JsonElement]. Cached under [safetyKey].
     */
    public fun safety(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /safety?vehicle_id={vehicleId}` — the safety history (web `useSafetyHistory`,
     * `safeArray`-guarded). Cached under [safetyHistoryKey].
     */
    public fun safetyHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /media/latest?vehicle_id={vehicleId}` — the latest media snapshot (web `useMedia`).
     * Carried as raw SI [JsonElement]. Cached under [mediaKey].
     */
    public fun media(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /media?vehicle_id={vehicleId}` — the media history (web `useMediaHistory`,
     * `safeArray`-guarded). Cached under [mediaHistoryKey].
     */
    public fun mediaHistory(vehicleId: String): Flow<Resource<JsonElement>>
}

// ---- Query builders (web param semantics, snake_case) -----------------------------

/**
 * The single-`vehicle_id` GET query shared by every per-vehicle VehicleSystems read that carries it
 * — the port of the web template literal `?vehicle_id=${vehicleId}`, which appends the key
 * unconditionally (the `enabled: !!vehicleId` truthiness check is a render-layer gate, not part of
 * the URL). The `useSoftwareUpdates` read deliberately does NOT use this builder: the web request is
 * the bare `/software-updates` with no query. Locked by golden vectors shared with the C# port.
 */
public fun vehicleSystemsVehicleIdQuery(vehicleId: String): Map<String, String> = mapOf("vehicle_id" to vehicleId)

// ---- Cache/feed keys (mirror the web vehicleSystemsKeys query keys) ----------------

/** The tuple separator used by every VehicleSystems cache key, matching the Driving port's `|`. */
internal const val VEHICLE_SYSTEMS_KEY_SEP: String = "|"

/** Cache/feed key for [VehicleSystemsRepository.climate] — the web `vehicleSystemsKeys.climate(vid)` (`['climate', vid]`). */
public fun climateKey(vehicleId: String): String = "climate$VEHICLE_SYSTEMS_KEY_SEP$vehicleId"

/**
 * Cache/feed key for [VehicleSystemsRepository.climateHistory] — the web
 * `vehicleSystemsKeys.climateHistory(vid)` (`['climate', 'history', vid]`).
 */
public fun climateHistoryKey(vehicleId: String): String = listOf("climate", "history", vehicleId).joinToString(VEHICLE_SYSTEMS_KEY_SEP)

/** Cache/feed key for [VehicleSystemsRepository.tirePressure] — the web `vehicleSystemsKeys.tirePressure(vid)` (`['tire-pressure', vid]`). */
public fun tirePressureKey(vehicleId: String): String = "tire-pressure$VEHICLE_SYSTEMS_KEY_SEP$vehicleId"

/**
 * Cache/feed key for [VehicleSystemsRepository.tirePressureHistory] — the web
 * `vehicleSystemsKeys.tirePressureHistory(vid)` (`['tire-pressure', 'history', vid]`).
 */
public fun tirePressureHistoryKey(vehicleId: String): String =
    listOf("tire-pressure", "history", vehicleId).joinToString(VEHICLE_SYSTEMS_KEY_SEP)

/** Cache/feed key for [VehicleSystemsRepository.maintenance] — the web `vehicleSystemsKeys.maintenance` (`['maintenance']`). */
public fun maintenanceKey(): String = "maintenance"

/** Cache/feed key for [VehicleSystemsRepository.serviceRecords] — the web `vehicleSystemsKeys.serviceRecords` (`['service-records']`). */
public fun serviceRecordsKey(): String = "service-records"

/** Cache/feed key for [VehicleSystemsRepository.softwareUpdates] — the web `vehicleSystemsKeys.softwareUpdates(vid)` (`['software-updates', vid]`). */
public fun softwareUpdatesKey(vehicleId: String): String = "software-updates$VEHICLE_SYSTEMS_KEY_SEP$vehicleId"

/** Cache/feed key for [VehicleSystemsRepository.safety] — the web `vehicleSystemsKeys.safety(vid)` (`['safety', vid]`). */
public fun safetyKey(vehicleId: String): String = "safety$VEHICLE_SYSTEMS_KEY_SEP$vehicleId"

/**
 * Cache/feed key for [VehicleSystemsRepository.safetyHistory] — the web
 * `vehicleSystemsKeys.safetyHistory(vid)` (`['safety', 'history', vid]`).
 */
public fun safetyHistoryKey(vehicleId: String): String = listOf("safety", "history", vehicleId).joinToString(VEHICLE_SYSTEMS_KEY_SEP)

/** Cache/feed key for [VehicleSystemsRepository.media] — the web `vehicleSystemsKeys.media(vid)` (`['media', vid]`). */
public fun mediaKey(vehicleId: String): String = "media$VEHICLE_SYSTEMS_KEY_SEP$vehicleId"

/**
 * Cache/feed key for [VehicleSystemsRepository.mediaHistory] — the web
 * `vehicleSystemsKeys.mediaHistory(vid)` (`['media', 'history', vid]`).
 */
public fun mediaHistoryKey(vehicleId: String): String = listOf("media", "history", vehicleId).joinToString(VEHICLE_SYSTEMS_KEY_SEP)

// ---- TTL overrides ----------------------------------------------------------------

/**
 * Per-entity staleness threshold for the global `useMaintenance`/`useServiceRecords` catalogs — the
 * web `STALE_TIMES.STATIC` (`Infinity`, never stale). Represented as the largest possible window so
 * the freshness math never flags these deployment-static reference feeds as stale, mirroring the
 * other STATIC ports (e.g. vehicle options/specs). The four "latest" + history + software-update
 * reads use the [io.teslasync.shared.core.cache.CacheDomain.VehicleSystems] domain default instead.
 */
public const val VEHICLE_SYSTEMS_STATIC_TTL_MILLIS: Long = Long.MAX_VALUE
