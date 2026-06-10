package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.presentation.charging.ApplyScheduleInput
import io.teslasync.shared.core.presentation.charging.OptimizeChargeInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the Charging domain — the cross-platform analogue of the web
 * `useCharging` hook domain (web/src/api/hooks/useCharging.ts). Every native Charging surface
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The eleven reads stream a cache-then-network [Resource] (ADR-013): the cached value first for
 * an instant cold start, then the refreshed value. Each is cached under a stable per-feed key
 * (see [chargingSessionsKey] etc.) mirroring the web TanStack query keys. List reads apply the
 * web `select: safeArray` guard before the cache write; the analytics-shaped reads (cost
 * forecast, optimizer, Tesla history/sessions, charge plans, rate plans) are carried as raw SI
 * [JsonElement] (the same verbatim-SI strategy as the Analytics/Admin ports). Session and
 * telemetry reads decode to the generated SI DTOs ([ChargingSession], [ChargeTelemetryReading]).
 *
 * The five mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT
 * touch the durable cache — the cache-then-network operator always re-fetches on the S8 store's
 * targeted family refresh (the `invalidateQueries` analogue), so the previous rows stay visible
 * during the reload while no stale value is ever served as fresh. Energy/power values are SI on
 * the wire (Wh, W) and stay SI through the cache; display conversion is the render boundary's
 * job (S5), never this layer's.
 */
public interface ChargingRepository {
    /**
     * `GET /charging-sessions?vehicle_id={vehicleId}` — a vehicle's charging sessions
     * (web `useChargingSessions`, `safeArray`-guarded). Cached under [chargingSessionsKey].
     */
    public fun sessions(vehicleId: Long): Flow<Resource<List<ChargingSession>>>

    /**
     * `GET /charging/{id}` — one charging session by its string id (web `useChargingSession`).
     * Cached under [chargingSessionDetailKey], mirroring the web `['charging-sessions', id]` key.
     */
    public fun session(id: String): Flow<Resource<ChargingSession>>

    /**
     * `GET /charging/{id}` — one charging session by its numeric id (web
     * `useChargingSessionDetail`). Cached under [chargingSessionByIdKey], mirroring the web
     * `['charging-session', id]` key (singular — distinct from [session]'s key, so a bulk
     * delete's `['charging-sessions']` invalidation does NOT touch it). The web hook's
     * `refetchInterval` on a live session is a UI polling cadence (S8/render concern), not a
     * data derivation, and is intentionally not reproduced at this layer.
     */
    public fun sessionDetail(id: Long): Flow<Resource<ChargingSession>>

    /**
     * `GET /charging/{sessionId}/telemetry` — per-session telemetry readings
     * (web `useChargeTelemetry`, `safeArray`-guarded). Cached under [chargeTelemetryKey].
     */
    public fun chargeTelemetry(sessionId: Long): Flow<Resource<List<ChargeTelemetryReading>>>

    /**
     * `GET /charging?vehicle_id={vehicleId}&limit&offset[&start][&end]` — paginated, optionally
     * date-filtered charging sessions (web `useChargingSessionsPaginated` → `getChargingSessions`,
     * `safeArray`-guarded). Cached under [chargingPaginatedKey].
     */
    public fun sessionsPaginated(
        vehicleId: Long,
        limit: Int = DEFAULT_LIMIT,
        offset: Int = 0,
        start: String? = null,
        end: String? = null,
    ): Flow<Resource<List<ChargingSession>>>

    /** `GET /analytics/cost-forecast?vehicle_id={vehicleId}&months={months}` (web `useCostForecast`). */
    public fun costForecast(
        vehicleId: String,
        months: Int = DEFAULT_FORECAST_MONTHS,
    ): Flow<Resource<JsonElement>>

    /** `GET /analytics/charging-optimizer?vehicle_id={vehicleId}` (web `useChargingOptimizer`). */
    public fun chargingOptimizer(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /tesla/charging/history[?vin={vin}]` — Supercharger/DC billing records
     * (web `useTeslaChargingHistory`). The `vin` param is sent only when present.
     */
    public fun teslaChargingHistory(vin: String? = null): Flow<Resource<JsonElement>>

    /**
     * `GET /tesla/charging/sessions[?vin={vin}]` — fleet charging sessions, business accounts
     * only (web `useTeslaChargingSessions`). The `vin` param is sent only when present.
     */
    public fun teslaChargingSessions(vin: String? = null): Flow<Resource<JsonElement>>

    /** `GET /charge-planner/history?vehicle_id={vehicleId}` — charge plan history (web `useChargePlans`, `safeArray`). */
    public fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>>

    /** `GET /charge-planner/rate-plans` — available TOU rate plans (web `useRatePlans`, `safeArray`). */
    public fun ratePlans(): Flow<Resource<JsonElement>>

    /**
     * `POST /tesla/charging/history/refresh[?vin&start_time&end_time]` — pulls fresh charging
     * history from the Tesla API (web `useRefreshTeslaChargingHistory`). Each query param is sent
     * only when present.
     */
    public suspend fun refreshTeslaChargingHistory(
        vin: String? = null,
        startTime: String? = null,
        endTime: String? = null,
    ): Result<JsonElement>

    /**
     * `POST /tesla/charging/sessions/refresh[?vin&date_from&date_to]` — pulls fresh fleet
     * charging sessions from the Tesla API (web `useRefreshTeslaChargingSessions`). Each query
     * param is sent only when present.
     */
    public suspend fun refreshTeslaChargingSessions(
        vin: String? = null,
        dateFrom: String? = null,
        dateTo: String? = null,
    ): Result<JsonElement>

    /** `POST /charge-planner/optimize` with the optimize body (web `useOptimizeCharge`). */
    public suspend fun optimizeCharge(input: OptimizeChargeInput): Result<JsonElement>

    /** `POST /charge-planner/apply` with `{ plan_id }` (web `useApplySchedule`). */
    public suspend fun applySchedule(input: ApplyScheduleInput): Result<JsonElement>

    /** `DELETE /charging/bulk` with `{ ids }` (web `useBulkDeleteCharging`). */
    public suspend fun bulkDeleteCharging(ids: List<Long>): Result<JsonElement>

    public companion object {
        /** The web `getChargingSessions(limit = 50)` default. */
        public const val DEFAULT_LIMIT: Int = 50

        /** The web `useCostForecast(months = 6)` default. */
        public const val DEFAULT_FORECAST_MONTHS: Int = 6
    }
}

// ---- Query builders (web param semantics, snake_case) -----------------------------

/**
 * The `/charging-sessions` query for [vehicleId] — the port of the web `useChargingSessions`
 * (``/charging-sessions?vehicle_id=${vehicleId}``). The `vehicle_id` key is unconditional (the
 * hook is `enabled` only with a vehicle). Locked by golden vectors shared with the C# port.
 */
public fun chargingSessionsQuery(vehicleId: Long): Map<String, String> = mapOf("vehicle_id" to vehicleId.toString())

/**
 * The `/charging` paginated query — the port of the web `getChargingSessions`. `vehicle_id`,
 * `limit`, `offset` are unconditional; `start`/`end` are sent only when non-blank (mirroring
 * JavaScript's truthy `if (start)` guard, so an empty string is treated as "no bound"). Locked
 * by golden vectors shared with the C# port.
 */
public fun chargingPaginatedQuery(
    vehicleId: Long,
    limit: Int,
    offset: Int,
    start: String?,
    end: String?,
): Map<String, String> {
    val query =
        linkedMapOf(
            "vehicle_id" to vehicleId.toString(),
            "limit" to limit.toString(),
            "offset" to offset.toString(),
        )
    if (!start.isNullOrEmpty()) query["start"] = start
    if (!end.isNullOrEmpty()) query["end"] = end
    return query
}

/**
 * The `/analytics/cost-forecast` query — the port of the web `useCostForecast`
 * (``?vehicle_id=${vehicleId}&months=${months}``). Both keys are unconditional. Locked by
 * golden vectors shared with the C# port.
 */
public fun costForecastQuery(
    vehicleId: String,
    months: Int,
): Map<String, String> =
    linkedMapOf(
        "vehicle_id" to vehicleId,
        "months" to months.toString(),
    )

/** The `/analytics/charging-optimizer` query (web `useChargingOptimizer`). */
public fun chargingOptimizerQuery(vehicleId: String): Map<String, String> = mapOf("vehicle_id" to vehicleId)

/** The `/charge-planner/history` query (web `useChargePlans`). */
public fun chargePlansQuery(vehicleId: Long): Map<String, String> = mapOf("vehicle_id" to vehicleId.toString())

/**
 * The Tesla `vin`-only GET query — the port of the web `${vin ? '?vin=' + vin : ''}` used by
 * both `useTeslaChargingHistory` and `useTeslaChargingSessions`. The `vin` key is sent only when
 * present AND non-blank (truthy guard). Locked by golden vectors shared with the C# port.
 */
public fun teslaVinQuery(vin: String?): Map<String, String> {
    val query = linkedMapOf<String, String>()
    vin?.takeIf { it.isNotEmpty() }?.let { query["vin"] = it }
    return query
}

/**
 * The `/tesla/charging/history/refresh` query — the port of the web
 * `useRefreshTeslaChargingHistory` `URLSearchParams`. Each of `vin`/`start_time`/`end_time` is
 * appended only when present AND non-blank (the web `if (params?.vin)` truthy guard). Locked by
 * golden vectors shared with the C# port.
 */
public fun teslaHistoryRefreshQuery(
    vin: String?,
    startTime: String?,
    endTime: String?,
): Map<String, String> {
    val query = linkedMapOf<String, String>()
    vin?.takeIf { it.isNotEmpty() }?.let { query["vin"] = it }
    startTime?.takeIf { it.isNotEmpty() }?.let { query["start_time"] = it }
    endTime?.takeIf { it.isNotEmpty() }?.let { query["end_time"] = it }
    return query
}

/**
 * The `/tesla/charging/sessions/refresh` query — the port of the web
 * `useRefreshTeslaChargingSessions` `URLSearchParams`. Each of `vin`/`date_from`/`date_to` is
 * appended only when present AND non-blank. Locked by golden vectors shared with the C# port.
 */
public fun teslaSessionsRefreshQuery(
    vin: String?,
    dateFrom: String?,
    dateTo: String?,
): Map<String, String> {
    val query = linkedMapOf<String, String>()
    vin?.takeIf { it.isNotEmpty() }?.let { query["vin"] = it }
    dateFrom?.takeIf { it.isNotEmpty() }?.let { query["date_from"] = it }
    dateTo?.takeIf { it.isNotEmpty() }?.let { query["date_to"] = it }
    return query
}

// ---- Cache/feed keys (mirror the web TanStack query keys) --------------------------

/** The tuple separator used by every Charging cache key, so family invalidation is boundary-safe. */
internal const val CHARGING_KEY_SEP: String = "|"

/** The `chargingKeys.all` family (`['charging-sessions']`) — sessions-by-vehicle + string-id detail. */
public const val CHARGING_SESSIONS_FAMILY: String = "charging-sessions"

/** The `chargePlannerKeys.all` family (`['charge-plans']`). */
public const val CHARGE_PLANS_FAMILY: String = "charge-plans"

/** The `teslaChargingHistoryKeys.all` family (`['tesla-charging-history']`). */
public const val TESLA_CHARGING_HISTORY_FAMILY: String = "tesla-charging-history"

/** The `teslaChargingSessionKeys.all` family (`['tesla-charging-sessions']`). */
public const val TESLA_CHARGING_SESSIONS_FAMILY: String = "tesla-charging-sessions"

/** Cache/feed key for [ChargingRepository.sessions] — the web `chargingKeys.byVehicle(vid)` (`['charging-sessions','vehicle',vid]`). */
public fun chargingSessionsKey(vehicleId: Long): String =
    listOf(CHARGING_SESSIONS_FAMILY, "vehicle", vehicleId.toString()).joinToString(CHARGING_KEY_SEP)

/** Cache/feed key for [ChargingRepository.session] — the web `chargingKeys.detail(id)` (`['charging-sessions', id]`). */
public fun chargingSessionDetailKey(id: String): String = listOf(CHARGING_SESSIONS_FAMILY, id).joinToString(CHARGING_KEY_SEP)

/** Cache/feed key for [ChargingRepository.sessionDetail] — the web `chargingKeys.detailById(id)` (`['charging-session', id]`). */
public fun chargingSessionByIdKey(id: Long): String = "charging-session$CHARGING_KEY_SEP$id"

/** Cache/feed key for [ChargingRepository.chargeTelemetry] — the web `chargingKeys.telemetry(id)` (`['charge-telemetry', id]`). */
public fun chargeTelemetryKey(sessionId: Long): String = "charge-telemetry$CHARGING_KEY_SEP$sessionId"

/** Cache/feed key for [ChargingRepository.sessionsPaginated] — the web `['charging', vehicleId, start, end, limit, offset]` tuple. */
public fun chargingPaginatedKey(
    vehicleId: Long,
    start: String?,
    end: String?,
    limit: Int,
    offset: Int,
): String =
    listOf(
        "charging",
        vehicleId.toString(),
        start ?: "",
        end ?: "",
        limit.toString(),
        offset.toString(),
    ).joinToString(CHARGING_KEY_SEP)

/** Cache/feed key for [ChargingRepository.costForecast] — the web `['cost-forecast', vehicleId, months]` tuple. */
public fun costForecastKey(
    vehicleId: String,
    months: Int,
): String = listOf("cost-forecast", vehicleId, months.toString()).joinToString(CHARGING_KEY_SEP)

/** Cache/feed key for [ChargingRepository.chargingOptimizer] — the web `['charging-optimizer', vehicleId]` tuple. */
public fun chargingOptimizerKey(vehicleId: String): String = "charging-optimizer$CHARGING_KEY_SEP$vehicleId"

/**
 * Cache/feed key for [ChargingRepository.teslaChargingHistory] — the web
 * `teslaChargingHistoryKeys.all` / `byVin(vin)`. A null/blank vin collapses to the family key
 * (mirroring the web `vin ? byVin(vin) : all`).
 */
public fun teslaChargingHistoryKey(vin: String?): String =
    vin?.takeIf { it.isNotEmpty() }?.let { "$TESLA_CHARGING_HISTORY_FAMILY$CHARGING_KEY_SEP$it" } ?: TESLA_CHARGING_HISTORY_FAMILY

/** Cache/feed key for [ChargingRepository.teslaChargingSessions] — the web `teslaChargingSessionKeys.all` / `byVin(vin)`. */
public fun teslaChargingSessionsKey(vin: String?): String =
    vin?.takeIf { it.isNotEmpty() }?.let { "$TESLA_CHARGING_SESSIONS_FAMILY$CHARGING_KEY_SEP$it" } ?: TESLA_CHARGING_SESSIONS_FAMILY

/** Cache/feed key for [ChargingRepository.chargePlans] — the web `chargePlannerKeys.byVehicle(vid)` (`['charge-plans', vid]`). */
public fun chargePlansKey(vehicleId: Long): String = "$CHARGE_PLANS_FAMILY$CHARGING_KEY_SEP$vehicleId"

/** Cache/feed key for [ChargingRepository.ratePlans] — the web `chargePlannerKeys.ratePlans` (`['charge-planner-rate-plans']`). */
public fun ratePlansKey(): String = "charge-planner-rate-plans"

/**
 * `true` when [key] belongs to the [family] under TanStack prefix-invalidation semantics: the
 * key either equals the family head exactly OR descends from it (`family` + separator + …). The
 * separator boundary keeps the plural `charging-sessions` family from matching the singular
 * `charging-session` detail key. Mirrors `invalidateQueries({ queryKey: [family] })`. Locked by
 * golden vectors shared with the C# port.
 */
public fun chargingKeyInFamily(
    key: String,
    family: String,
): Boolean = key == family || key.startsWith("$family$CHARGING_KEY_SEP")
