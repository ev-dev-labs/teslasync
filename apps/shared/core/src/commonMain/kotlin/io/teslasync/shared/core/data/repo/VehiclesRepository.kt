package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The S7 data port for the Vehicles domain — the cross-platform analogue of the web `useVehicles`
 * hook domain (web/src/api/hooks/useVehicles.ts). Every native Vehicles surface (Android/Apple via
 * KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a single
 * fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The twenty-one reads stream a cache-then-network [Resource] (ADR-013): the cached value first for
 * an instant cold start, then the refreshed value. Each is cached under a stable per-feed key
 * (see [vehiclesKey] etc.) mirroring the web TanStack query keys. The enrolled-vehicle list decodes
 * to the generated SI DTO [Vehicle] (`safeArray`-guarded — the web `select: safeArray`), the detail
 * decodes to [Vehicle], and [vehicleState] folds the raw response into a typed [VehicleStateEnvelope]
 * via [normalizeVehicleStateResponse] (the web `useVehicleState` normalisation). Every other read —
 * the positions track, the motor/climate/security/tire/charging-telemetry/media/location/config/
 * user-preference "latest" projections, the motor history, and the Tesla info envelopes (mobile
 * enabled, options, specs, subscriptions, upgrades, warranty) — is carried verbatim as a raw SI
 * [JsonElement] (the same strategy as the Driving/Analytics ports), because those shapes have no
 * generated DTO. The `positions` and `motor-history` array reads also apply the `safeArray` guard.
 *
 * The ten mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT touch
 * the durable cache — the cache-then-network operator always re-fetches when the S8 store bumps the
 * affected family's triggers (the `invalidateQueries` analogue), so the previous rows stay visible
 * during the reload while no stale value is ever served as fresh.
 *
 * The web per-read `staleTime`s are reproduced as S7 TTLs ([STALE_FAST_MS] etc.); the
 * `refetchInterval` polls, the `enabled` lazy gates (`vehicleId > 0`, `!!vehicleId`), and the
 * mutation toasts are render-layer concerns and are intentionally NOT reproduced at this layer.
 * Distances/speeds/temps/pressures stay SI on the wire and through the cache; conversion is the
 * render boundary's job (S5).
 */
public interface VehiclesRepository {
    // ---- Reads --------------------------------------------------------------------

    /** `GET /vehicles` — the enrolled-vehicle list (web `useVehicles`, `safeArray`-guarded). */
    public fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** `GET /vehicles/{id}` — one vehicle's detail (web `useVehicle`). */
    public fun vehicle(id: String): Flow<Resource<Vehicle>>

    /**
     * `GET /vehicles/{vehicleId}/state[?as_of={asOf}]` — the vehicle's last-known state
     * (web `useVehicleState`). The raw response is normalised to a [VehicleStateEnvelope] via
     * [normalizeVehicleStateResponse]. The optional time-machine [asOf] is sent as `as_of` only when
     * present (the web `withAsOf` guard) and participates in the cache key.
     */
    public fun vehicleState(
        vehicleId: Long,
        asOf: String? = null,
    ): Flow<Resource<VehicleStateEnvelope>>

    /**
     * `GET /vehicles/{vehicleId}/positions?limit={limit}` — the vehicle's recent positions
     * (web `useVehiclePositions`, `safeArray`-guarded, default limit 100).
     */
    public fun vehiclePositions(
        vehicleId: Long,
        limit: Int = DEFAULT_POSITIONS_LIMIT,
    ): Flow<Resource<JsonElement>>

    /** `GET /motor/latest?vehicle_id={vehicleId}` — the latest motor snapshot (web `useMotorLatest`). */
    public fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /**
     * `GET /motor?vehicle_id={vehicleId}&limit={limit}` — the motor history
     * (web `useMotorHistory`, `safeArray`-guarded, default limit 200).
     */
    public fun motorHistory(
        vehicleId: Long,
        limit: Int = DEFAULT_MOTOR_HISTORY_LIMIT,
    ): Flow<Resource<JsonElement>>

    /** `GET /drive-dynamics/latest?vehicle_id={vehicleId}` — the latest g-force/pedal surface (web `useDriveDynamicsLatest`). */
    public fun driveDynamicsLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /climate/latest?vehicle_id={vehicleId}` — the latest climate snapshot (web `useClimateLatest`). */
    public fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /security/latest?vehicle_id={vehicleId}` — the latest security event (web `useSecurityLatest`). */
    public fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /tire-pressure/latest?vehicle_id={vehicleId}` — the latest tire-pressure snapshot (web `useLatestTirePressure`). */
    public fun latestTirePressure(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /charging-telemetry/latest?vehicle_id={vehicleId}` — the latest charging telemetry (web `useChargingTelemetryLatest`). */
    public fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /media/latest?vehicle_id={vehicleId}` — the latest media snapshot (web `useMediaLatest`). */
    public fun mediaLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /location-snapshots/latest?vehicle_id={vehicleId}` — the latest location snapshot (web `useLocationSnapshotLatest`). */
    public fun locationSnapshotLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /vehicle-config/latest?vehicle_id={vehicleId}` — the latest vehicle-config snapshot (web `useVehicleConfigLatest`). */
    public fun vehicleConfigLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /user-preferences/latest?vehicle_id={vehicleId}` — the latest user-preference snapshot (web `useUserPreferenceLatest`). */
    public fun userPreferenceLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{id}/mobile-enabled` — the mobile-access info envelope (web `useVehicleMobileEnabled`). */
    public fun vehicleMobileEnabled(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{id}/options` — the option-codes info envelope (web `useVehicleOptions`). */
    public fun vehicleOptions(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{id}/specs` — the vehicle-specs info envelope (web `useVehicleSpecs`). */
    public fun vehicleSpecs(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{id}/subscriptions` — the subscription-eligibility info envelope (web `useVehicleSubscriptions`). */
    public fun vehicleSubscriptions(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{id}/upgrades` — the upgrade-eligibility info envelope (web `useVehicleUpgrades`). */
    public fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /tesla/warranty` — the account-level warranty info envelope (web `useWarrantyDetails`). */
    public fun warrantyDetails(): Flow<Resource<JsonElement>>

    // ---- Mutations ----------------------------------------------------------------

    /**
     * `POST /vehicles/{id}/wake` (web `useRefreshVehicle`). Returns the refreshed [Vehicle]; the web
     * hook seeds the detail cache with it and invalidates `['vehicles']`, so the S8 store refreshes
     * the [VEHICLES_FAMILY] (which covers both the list and the per-vehicle detail).
     */
    public suspend fun refreshVehicle(id: String): Result<Vehicle>

    /**
     * `DELETE /vehicles/{id}` (web `useDeleteVehicle`). The web hook invalidates `['vehicles']`, so
     * the S8 store refreshes the [VEHICLES_FAMILY].
     */
    public suspend fun deleteVehicle(id: Long): Result<Unit>

    /**
     * `POST /vehicles/sync` (web `useSyncVehicles`). The web hook invalidates `['vehicles']`, so the
     * S8 store refreshes the [VEHICLES_FAMILY].
     */
    public suspend fun syncVehicles(): Result<JsonElement>

    /**
     * `POST /vehicles/{id}/wake` (web `useWakeVehicle`). The web hook only toasts — it invalidates
     * nothing — so the S8 store refreshes no feed.
     */
    public suspend fun wakeVehicle(id: Long): Result<JsonElement>

    /** `POST /vehicles/{id}/mobile-enabled/refresh` (web `useRefreshVehicleMobileEnabled`). Refreshes [mobileEnabledKey]. */
    public suspend fun refreshVehicleMobileEnabled(id: String): Result<JsonElement>

    /** `POST /vehicles/{id}/options/refresh` (web `useRefreshVehicleOptions`). Refreshes [vehicleOptionsKey]. */
    public suspend fun refreshVehicleOptions(id: String): Result<JsonElement>

    /** `POST /vehicles/{id}/specs/refresh` (web `useRefreshVehicleSpecs`). Refreshes [vehicleSpecsKey]. */
    public suspend fun refreshVehicleSpecs(id: String): Result<JsonElement>

    /** `POST /vehicles/{id}/subscriptions/refresh` (web `useRefreshVehicleSubscriptions`). Refreshes [vehicleSubscriptionsKey]. */
    public suspend fun refreshVehicleSubscriptions(id: String): Result<JsonElement>

    /** `POST /vehicles/{id}/upgrades/refresh` (web `useRefreshVehicleUpgrades`). Refreshes [vehicleUpgradesKey]. */
    public suspend fun refreshVehicleUpgrades(id: String): Result<JsonElement>

    /** `POST /tesla/warranty/refresh` (web `useRefreshWarrantyDetails`). Refreshes [warrantyDetailsKey]. */
    public suspend fun refreshWarrantyDetails(): Result<JsonElement>

    public companion object {
        /** The web `useVehiclePositions(limit = 100)` default. */
        public const val DEFAULT_POSITIONS_LIMIT: Int = 100

        /** The web `useMotorHistory(limit = 200)` default. */
        public const val DEFAULT_MOTOR_HISTORY_LIMIT: Int = 200

        /** `STALE_TIMES.FAST` (30s) — the web `useVehicles` list staleTime. */
        public const val STALE_FAST_MS: Long = 30_000L

        /** `STALE_TIMES.SLOW` (5min) — the web `useVehicleMobileEnabled` staleTime. */
        public const val STALE_SLOW_MS: Long = 5 * 60_000L

        /** `STALE_TIMES.RARE` (1h) — the web `useVehicleSubscriptions`/`useVehicleUpgrades` staleTime. */
        public const val STALE_RARE_MS: Long = 60 * 60_000L

        /** `STALE_TIMES.DAILY` (24h) — the web `useWarrantyDetails` staleTime. */
        public const val STALE_DAILY_MS: Long = 24 * 60 * 60_000L

        /** `STALE_TIMES.STATIC` (never stale) — the web `useVehicleOptions`/`useVehicleSpecs` staleTime. */
        public const val STALE_STATIC_MS: Long = Long.MAX_VALUE
    }
}

// ---- Query builders (web param semantics, snake_case) -----------------------------

/**
 * The single-`vehicle_id` GET query shared by every per-vehicle "latest"/history read
 * (`useMotorLatest`/`useMotorHistory`/`useDriveDynamicsLatest`/`useClimateLatest`/… ): the web
 * always sends `?vehicle_id=${vehicleId}` for the numeric vehicle id (unconditional, unlike the
 * Driving truthy guard). Locked by golden vectors shared with the C# port.
 */
public fun vehicleIdQuery(vehicleId: Long): Map<String, String> = linkedMapOf("vehicle_id" to vehicleId.toString())

/** The `/vehicles/{id}/positions` query (web `useVehiclePositions`: `?limit=${limit}`). */
public fun vehiclePositionsQuery(limit: Int): Map<String, String> = linkedMapOf("limit" to limit.toString())

/**
 * The `/motor` history query (web `useMotorHistory`: `?vehicle_id=${vehicleId}&limit=${limit}`).
 * Both keys are unconditional. Locked by golden vectors shared with the C# port.
 */
public fun motorHistoryQuery(
    vehicleId: Long,
    limit: Int,
): Map<String, String> =
    linkedMapOf(
        "vehicle_id" to vehicleId.toString(),
        "limit" to limit.toString(),
    )

/**
 * The `/vehicles/{id}/state` query — the port of the web `withAsOf` guard: the `as_of` key is sent
 * only when [asOf] is present AND non-blank, so live-mode reads stay on the bare state path. Locked
 * by golden vectors shared with the C# port.
 */
public fun vehicleStateQuery(asOf: String?): Map<String, String> {
    val query = linkedMapOf<String, String>()
    asOf?.takeIf { it.isNotEmpty() }?.let { query["as_of"] = it }
    return query
}

// ---- Cache/feed keys (mirror the web TanStack query keys) --------------------------

/** The tuple separator used by every Vehicles cache key, so family invalidation is boundary-safe. */
internal const val VEHICLES_KEY_SEP: String = "|"

/**
 * The `vehicleKeys.all` family (`['vehicles']`) — the enrolled-vehicle list AND every per-vehicle
 * detail (`['vehicles', id]`), both of which the web `useRefreshVehicle`/`useDeleteVehicle`/
 * `useSyncVehicles` invalidate via `invalidateQueries({ queryKey: ['vehicles'] })`. The `|`
 * separator boundary keeps this family from matching the `vehicle-state`/`vehicle-options`/… cousins
 * (which the web keys under distinct heads like `['vehicle-state', …]`).
 */
public const val VEHICLES_FAMILY: String = "vehicles"

/** Cache/feed key for [VehiclesRepository.vehicles] — the web `vehicleKeys.all` (`['vehicles']`). */
public fun vehiclesKey(): String = VEHICLES_FAMILY

/** Cache/feed key for [VehiclesRepository.vehicle] — the web `vehicleKeys.detail(id)` (`['vehicles', id]`). */
public fun vehicleDetailKey(id: String): String = "$VEHICLES_FAMILY$VEHICLES_KEY_SEP$id"

/**
 * Cache/feed key for [VehiclesRepository.vehicleState] — the web `vehicleKeys.state(id, asOf)`
 * (`['vehicle-state', id]` live, or `['vehicle-state', id, asOf]` in time-machine mode). The `asOf`
 * slot is appended only when present, so a live read and a historical read are distinct feeds.
 */
public fun vehicleStateKey(
    vehicleId: Long,
    asOf: String? = null,
): String =
    if (asOf.isNullOrEmpty()) {
        "vehicle-state$VEHICLES_KEY_SEP$vehicleId"
    } else {
        listOf("vehicle-state", vehicleId.toString(), asOf).joinToString(VEHICLES_KEY_SEP)
    }

/** Cache/feed key for [VehiclesRepository.vehiclePositions] — the web `vehicleKeys.positions(id)` (`['vehicle-positions', id]`). */
public fun vehiclePositionsKey(vehicleId: Long): String = "vehicle-positions$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.motorLatest] — the web `['motor-latest', id]`. */
public fun motorLatestKey(vehicleId: Long): String = "motor-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.motorHistory] — the web `['motor-history', id, limit]`. */
public fun motorHistoryKey(
    vehicleId: Long,
    limit: Int,
): String = listOf("motor-history", vehicleId.toString(), limit.toString()).joinToString(VEHICLES_KEY_SEP)

/** Cache/feed key for [VehiclesRepository.driveDynamicsLatest] — the web `['drive-dynamics-latest', id]`. */
public fun driveDynamicsLatestKey(vehicleId: Long): String = "drive-dynamics-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.climateLatest] — the web `['climate-latest', id]`. */
public fun climateLatestKey(vehicleId: Long): String = "climate-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.securityLatest] — the web `['security-latest', id]`. */
public fun securityLatestKey(vehicleId: Long): String = "security-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.latestTirePressure] — the web `['tire-latest', id]`. */
public fun tirePressureLatestKey(vehicleId: Long): String = "tire-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.chargingTelemetryLatest] — the web `['charging-telemetry-latest', id]`. */
public fun chargingTelemetryLatestKey(vehicleId: Long): String = "charging-telemetry-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.mediaLatest] — the web `['media-latest', id]`. */
public fun mediaLatestKey(vehicleId: Long): String = "media-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.locationSnapshotLatest] — the web `['location-latest', id]`. */
public fun locationSnapshotLatestKey(vehicleId: Long): String = "location-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.vehicleConfigLatest] — the web `['vehicle-config-latest', id]`. */
public fun vehicleConfigLatestKey(vehicleId: Long): String = "vehicle-config-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.userPreferenceLatest] — the web `['user-pref-latest', id]`. */
public fun userPreferenceLatestKey(vehicleId: Long): String = "user-pref-latest$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.vehicleMobileEnabled] — the web `['vehicle-mobile-enabled', id]`. */
public fun mobileEnabledKey(vehicleId: String): String = "vehicle-mobile-enabled$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.vehicleOptions] — the web `['vehicle-options', id]`. */
public fun vehicleOptionsKey(vehicleId: String): String = "vehicle-options$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.vehicleSpecs] — the web `['vehicle-specs', id]`. */
public fun vehicleSpecsKey(vehicleId: String): String = "vehicle-specs$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.vehicleSubscriptions] — the web `['vehicle-subscriptions', id]`. */
public fun vehicleSubscriptionsKey(vehicleId: String): String = "vehicle-subscriptions$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.vehicleUpgrades] — the web `['vehicle-upgrades', id]`. */
public fun vehicleUpgradesKey(vehicleId: String): String = "vehicle-upgrades$VEHICLES_KEY_SEP$vehicleId"

/** Cache/feed key for [VehiclesRepository.warrantyDetails] — the web `['warranty-details']`. */
public fun warrantyDetailsKey(): String = "warranty-details"

/**
 * `true` when [key] belongs to the [family] under TanStack prefix-invalidation semantics: the key
 * either equals the family head exactly OR descends from it (`family` + separator + …). The
 * separator boundary keeps the `['vehicles']` family from matching the `vehicle-state`/
 * `vehicle-options`/… cousin heads. Mirrors `invalidateQueries({ queryKey: [family] })`. Locked by
 * golden vectors shared with the C# port.
 */
public fun vehiclesKeyInFamily(
    key: String,
    family: String,
): Boolean = key == family || key.startsWith("$family$VEHICLES_KEY_SEP")

// ---- Client-side derivation: useVehicleState normalisation ------------------------

/**
 * The cross-platform port of the web `useVehicleState` response normalisation
 * (web/src/api/hooks/useVehicles.ts). Folds the three on-the-wire shapes into one typed
 * [VehicleStateEnvelope]:
 *  1. an already-normalised `{ state: { …, vehicle_id }, live }` ⇒ decode `state` verbatim;
 *  2. neither `vehicle` nor `position` present ⇒ `state = null` (the web `state: undefined` branch);
 *  3. the legacy `{ vehicle, position, … }` shape ⇒ build a [VehicleState] field-by-field with the
 *     web's EXACT defaults (`v?.id ?? vehicleId`, `?? 'offline'`, `?? 0`, `?? false`, `?? true` for
 *     `is_locked`, `rated_range ?? ideal_range ?? 0`, `software_version` falling back to the
 *     vehicle's).
 *
 * Every value stays SI (ranges in meters, speeds in m/s, temps in °C). Locked by golden vectors
 * shared with the C# port so the two ports cannot drift (ADR-004).
 */
public fun normalizeVehicleStateResponse(
    response: JsonElement,
    vehicleId: Long,
): VehicleStateEnvelope {
    val root = response as? JsonObject ?: return VehicleStateEnvelope(state = null, live = false)
    val live = root["live"]?.asBoolean() ?: false

    val stateField = root["state"] as? JsonObject
    if (stateField != null && stateField.containsKey("vehicle_id")) {
        return VehicleStateEnvelope(state = decodeVehicleState(stateField), live = live)
    }

    val vehicle = root["vehicle"] as? JsonObject
    val position = root["position"] as? JsonObject
    if (vehicle == null && position == null) {
        return VehicleStateEnvelope(state = null, live = live)
    }

    val state =
        VehicleState(
            vehicleId = vehicle?.get("id")?.asLong() ?: vehicleId,
            state = vehicle?.get("state")?.asString() ?: "offline",
            latitude = position?.get("latitude")?.asDouble() ?: 0.0,
            longitude = position?.get("longitude")?.asDouble() ?: 0.0,
            speed = position?.get("speed")?.asDouble() ?: 0.0,
            power = position?.get("power")?.asDouble() ?: 0.0,
            batteryLevel = position?.get("battery_level")?.asLong() ?: 0L,
            ratedRange =
                position?.get("rated_range")?.asDouble()
                    ?: position?.get("ideal_range")?.asDouble() ?: 0.0,
            idealRange = position?.get("ideal_range")?.asDouble() ?: 0.0,
            odometer = position?.get("odometer")?.asDouble() ?: 0.0,
            insideTemp = position?.get("inside_temp")?.asDouble() ?: 0.0,
            outsideTemp = position?.get("outside_temp")?.asDouble() ?: 0.0,
            isClimateOn = position?.get("is_climate_on")?.asBoolean() ?: false,
            isCharging = root["is_charging"]?.asBoolean() ?: false,
            chargerPower = root["charger_power"]?.asDouble() ?: 0.0,
            chargeRate = root["charge_rate"]?.asDouble() ?: 0.0,
            timeToFullCharge = root["time_to_full_charge"]?.asDouble() ?: 0.0,
            isLocked = root["is_locked"]?.asBoolean() ?: vehicle?.get("is_locked")?.asBoolean() ?: true,
            sentryMode = root["sentry_mode"]?.asBoolean() ?: false,
            softwareVersion =
                root["software_version"]?.asString()
                    ?: vehicle?.get("software_version")?.asString() ?: "",
        )
    return VehicleStateEnvelope(state = state, live = live)
}

/** Decodes an already-normalised `state` object into a [VehicleState] with the web `?? 0/false/''` defaults. */
private fun decodeVehicleState(obj: JsonObject): VehicleState =
    VehicleState(
        vehicleId = obj["vehicle_id"]?.asLong() ?: 0L,
        state = obj["state"]?.asString() ?: "offline",
        latitude = obj["latitude"]?.asDouble() ?: 0.0,
        longitude = obj["longitude"]?.asDouble() ?: 0.0,
        speed = obj["speed"]?.asDouble() ?: 0.0,
        power = obj["power"]?.asDouble() ?: 0.0,
        batteryLevel = obj["battery_level"]?.asLong() ?: 0L,
        ratedRange = obj["rated_range"]?.asDouble() ?: 0.0,
        idealRange = obj["ideal_range"]?.asDouble() ?: 0.0,
        odometer = obj["odometer"]?.asDouble() ?: 0.0,
        insideTemp = obj["inside_temp"]?.asDouble() ?: 0.0,
        outsideTemp = obj["outside_temp"]?.asDouble() ?: 0.0,
        isClimateOn = obj["is_climate_on"]?.asBoolean() ?: false,
        isCharging = obj["is_charging"]?.asBoolean() ?: false,
        chargerPower = obj["charger_power"]?.asDouble() ?: 0.0,
        chargeRate = obj["charge_rate"]?.asDouble() ?: 0.0,
        timeToFullCharge = obj["time_to_full_charge"]?.asDouble() ?: 0.0,
        isLocked = obj["is_locked"]?.asBoolean() ?: true,
        sentryMode = obj["sentry_mode"]?.asBoolean() ?: false,
        softwareVersion = obj["software_version"]?.asString() ?: "",
    )

private fun JsonElement.asPrimitive(): JsonPrimitive? = this as? JsonPrimitive

private fun JsonElement.asDouble(): Double? = asPrimitive()?.doubleOrNull

private fun JsonElement.asLong(): Long? = asPrimitive()?.longOrNull

private fun JsonElement.asBoolean(): Boolean? = asPrimitive()?.booleanOrNull

private fun JsonElement.asString(): String? {
    val primitive = asPrimitive() ?: return null
    return if (primitive.isString) primitive.content else null
}
