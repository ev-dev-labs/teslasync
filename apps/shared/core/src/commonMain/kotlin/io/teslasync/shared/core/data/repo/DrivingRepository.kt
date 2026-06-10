package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.presentation.driving.TripPlanRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the Driving domain — the cross-platform analogue of the web `useDriving`
 * hook domain (web/src/api/hooks/useDriving.ts). Every native Driving surface (Android/Apple via
 * KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a
 * single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The fifteen reads stream a cache-then-network [Resource] (ADR-013): the cached value first for
 * an instant cold start, then the refreshed value. Each is cached under a stable per-feed key
 * (see [drivesKey] etc.) mirroring the web TanStack query keys. The `drives` list decodes to the
 * generated SI DTO [Drive] and the per-drive telemetry decodes to [DriveTelemetryReading] (both
 * `safeArray`-guarded — the web `select: safeArray`); every other read is carried verbatim as a
 * raw SI [JsonElement] (the same strategy as the Analytics/Charging ports), because those shapes
 * (drive detail, score, stats, dynamics, drivetrain health, the analytics-derived speed/regen/
 * route/coach feeds, positions, geocode results and the why-ended diagnostic) have no generated
 * DTO. The `positions` and `geocode` array reads also apply the `safeArray` guard.
 *
 * The two mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT
 * touch the durable cache — the cache-then-network operator always re-fetches on the S8 store's
 * targeted family refresh (the `invalidateQueries` analogue), so the previous rows stay visible
 * during the reload while no stale value is ever served as fresh. Distances/speeds/energy stay SI
 * on the wire (meters, m/s, Wh, W) and through the cache; display conversion is the render
 * boundary's job (S5), never this layer's.
 *
 * The web `useDrive` `refetchInterval` (poll a live drive), the web `useDriveWhyEnded`
 * `refetchInterval`/`enabled` lazy gate, the `useGeocodeSearch` `query.length >= 3` `enabled`
 * gate, and the mutation toasts are all render-layer concerns and are intentionally NOT
 * reproduced at this layer.
 */
public interface DrivingRepository {
    /**
     * `GET /drives/?vehicle_id={vehicleId}` — a vehicle's recent drives (web `useDrives`,
     * `safeArray`-guarded). Cached under [drivesKey].
     */
    public fun drives(vehicleId: String): Flow<Resource<List<Drive>>>

    /**
     * `GET /drives/{id}/` — one drive's full detail incl. positions + telemetry
     * (web `useDrive`). Carried as raw SI [JsonElement] (no generated DriveDetail DTO). Cached
     * under [driveDetailKey], mirroring the web `['drive', id]` key.
     */
    public fun drive(id: String): Flow<Resource<JsonElement>>

    /** `GET /drives/score?vehicle_id={vehicleId}` — the vehicle's drive-score card (web `useDriveScore`). */
    public fun driveScore(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /drives/stats?vehicle_id={vehicleId}` — aggregate driving stats (web `useDrivingStats`). */
    public fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /drives/dynamics?vehicle_id={vehicleId}` — g-force dynamics (web `useDrivingDynamics`). */
    public fun drivingDynamics(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /drives/acceleration-distribution?vehicle_id={vehicleId}` — the acceleration histogram
     * (web `useAccelerationDistribution`).
     */
    public fun accelerationDistribution(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /drivetrain/health?vehicle_id={vehicleId}` — drivetrain/motor health (web `useDrivetrainHealth`). */
    public fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /analytics/speed-profile?vehicle_id={vehicleId}[&start][&end]` — the speed/power profile
     * (web `useSpeedProfile`). The `start`/`end` params are sent only when present.
     */
    public fun speedProfile(
        vehicleId: String,
        start: String? = null,
        end: String? = null,
    ): Flow<Resource<JsonElement>>

    /**
     * `GET /analytics/regen?vehicle_id={vehicleId}[&start][&end]` — regen-efficiency analytics
     * (web `useRegenEfficiency`). The `start`/`end` params are sent only when present.
     */
    public fun regenEfficiency(
        vehicleId: String,
        start: String? = null,
        end: String? = null,
    ): Flow<Resource<JsonElement>>

    /**
     * `GET /analytics/route-efficiency?vehicle_id={vehicleId}[&start][&end]` — per-route efficiency
     * (web `useRouteEfficiency`). The `start`/`end` params are sent only when present.
     */
    public fun routeEfficiency(
        vehicleId: String,
        start: String? = null,
        end: String? = null,
    ): Flow<Resource<JsonElement>>

    /**
     * `GET /drives/{driveID}/positions` — the drive's GPS track (web `useDrivePositions`,
     * `safeArray`-guarded). Carried as raw SI [JsonElement]. Cached under [drivePositionsKey].
     */
    public fun drivePositions(driveId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /drives/{driveID}/telemetry` — the drive's telemetry samples (web `useDriveTelemetry`,
     * `safeArray`-guarded). Decodes to the generated SI DTO [DriveTelemetryReading]. Cached under
     * [driveTelemetryKey].
     */
    public fun driveTelemetry(driveId: String): Flow<Resource<List<DriveTelemetryReading>>>

    /**
     * `GET /analytics/driving-coach?vehicle_id={vehicleId}&days={days}` — the driving-coach report
     * (web `useDrivingCoach`, default 30 days). Cached under [drivingCoachKey].
     */
    public fun drivingCoach(
        vehicleId: String,
        days: Int = DEFAULT_COACH_DAYS,
    ): Flow<Resource<JsonElement>>

    /**
     * `GET /geocode/search?q={query}&limit=5` — geocoder autocomplete (web `useGeocodeSearch`,
     * `safeArray`-guarded). Cached under [geocodeSearchKey]. The web `query.length >= 3` `enabled`
     * gate is a render-layer concern and is not reproduced here.
     */
    public fun geocodeSearch(query: String): Flow<Resource<JsonElement>>

    /**
     * `GET /drives/{driveID}/why-ended?window={window}` — the drive-end diagnostic feed
     * (web `useDriveWhyEnded`, default `60s` window). Cached under [driveWhyEndedKey], which lives
     * UNDER the `drive` family so the bulk-delete `['drive']` invalidation also refreshes it,
     * matching the web TanStack prefix semantics. The web `refetchInterval`/`enabled` lazy gate is
     * a render-layer concern and is not reproduced here.
     */
    public fun driveWhyEnded(
        driveId: String,
        window: String = DEFAULT_WHY_ENDED_WINDOW,
    ): Flow<Resource<JsonElement>>

    /**
     * `POST /trip-planner/plan` with the [TripPlanRequest] body (web `usePlanTrip`). Returns the
     * computed plan verbatim (SI). The web hook only toasts on success — it invalidates nothing —
     * so the S8 store refreshes no feed.
     */
    public suspend fun planTrip(input: TripPlanRequest): Result<JsonElement>

    /**
     * `DELETE /drives/bulk` with `{ ids }` (web `useBulkDeleteDrives`). The web hook invalidates
     * both `['drives']` and `['drive']` on success, so the S8 store refreshes both families.
     */
    public suspend fun bulkDeleteDrives(ids: List<Long>): Result<JsonElement>

    public companion object {
        /** The web `useDrivingCoach(days = 30)` default. */
        public const val DEFAULT_COACH_DAYS: Int = 30

        /** The web `useDriveWhyEnded(window = '60s')` default. */
        public const val DEFAULT_WHY_ENDED_WINDOW: String = "60s"

        /** The web `useGeocodeSearch` fixed `limit=5`. */
        public const val GEOCODE_LIMIT: Int = 5
    }
}

// ---- Query builders (web param semantics, snake_case) -----------------------------

/**
 * The single-`vehicle_id` GET query shared by `useDrives`/`useDriveScore`/`useDrivingStats`/
 * `useDrivingDynamics`/`useAccelerationDistribution`/`useDrivetrainHealth` — the port of the web
 * `vehicleId ? '?vehicle_id=' + vehicleId : ''` truthy guard: the `vehicle_id` key is sent only
 * when present AND non-blank, so an empty string is treated as "no vehicle". Locked by golden
 * vectors shared with the C# port.
 */
public fun driveVehicleIdQuery(vehicleId: String?): Map<String, String> {
    val query = linkedMapOf<String, String>()
    vehicleId?.takeIf { it.isNotEmpty() }?.let { query["vehicle_id"] = it }
    return query
}

/**
 * The `/analytics/{speed-profile|regen|route-efficiency}` query — the port of the web
 * `URLSearchParams` built by `useSpeedProfile`/`useRegenEfficiency`/`useRouteEfficiency`:
 * `vehicle_id` is unconditional; `start`/`end` are appended only when present AND non-blank
 * (mirroring JavaScript's truthy `if (start)` guard). Locked by golden vectors shared with the
 * C# port.
 */
public fun driveAnalyticsRangeQuery(
    vehicleId: String,
    start: String?,
    end: String?,
): Map<String, String> {
    val query = linkedMapOf("vehicle_id" to vehicleId)
    if (!start.isNullOrEmpty()) query["start"] = start
    if (!end.isNullOrEmpty()) query["end"] = end
    return query
}

/**
 * The `/analytics/driving-coach` query (web `useDrivingCoach`: `?vehicle_id=${vehicleId}&days=
 * ${days}`). Both keys are unconditional. Locked by golden vectors shared with the C# port.
 */
public fun drivingCoachQuery(
    vehicleId: String,
    days: Int,
): Map<String, String> =
    linkedMapOf(
        "vehicle_id" to vehicleId,
        "days" to days.toString(),
    )

/**
 * The `/geocode/search` query (web `useGeocodeSearch`: `?q=${encodeURIComponent(query)}&limit=5`).
 * The `q` value is sent raw — percent-encoding is the HTTP client's job (it mirrors the web
 * `encodeURIComponent`). Locked by golden vectors shared with the C# port.
 */
public fun geocodeSearchQuery(query: String): Map<String, String> =
    linkedMapOf(
        "q" to query,
        "limit" to DrivingRepository.GEOCODE_LIMIT.toString(),
    )

/** The `/drives/{id}/why-ended` query (web `useDriveWhyEnded`: `?window=${window}`). */
public fun driveWhyEndedQuery(window: String): Map<String, String> = mapOf("window" to window)

// ---- Cache/feed keys (mirror the web TanStack query keys) --------------------------

/** The tuple separator used by every Driving cache key, so family invalidation is boundary-safe. */
internal const val DRIVING_KEY_SEP: String = "|"

/** The `drivingKeys.drives` family (`['drives']`) — the per-vehicle drive lists. */
public const val DRIVES_FAMILY: String = "drives"

/**
 * The `['drive']` family — the per-drive detail AND the why-ended diagnostic (`['drive', id,
 * 'why-ended', window]`), both of which the web `useBulkDeleteDrives` invalidates via
 * `invalidateQueries({ queryKey: ['drive'] })`. The `|` separator boundary keeps this singular
 * family from matching the plural `drives` lists or the `drive-score`/`drive-positions`/
 * `drive-telemetry` siblings.
 */
public const val DRIVE_FAMILY: String = "drive"

/** Cache/feed key for [DrivingRepository.drives] — the web `drivingKeys.drives(vid)` (`['drives', vid]`). */
public fun drivesKey(vehicleId: String): String = "$DRIVES_FAMILY$DRIVING_KEY_SEP$vehicleId"

/** Cache/feed key for [DrivingRepository.drive] — the web `drivingKeys.drive(id)` (`['drive', id]`). */
public fun driveDetailKey(id: String): String = "$DRIVE_FAMILY$DRIVING_KEY_SEP$id"

/** Cache/feed key for [DrivingRepository.driveScore] — the web `drivingKeys.score(vid)` (`['drive-score', vid]`). */
public fun driveScoreKey(vehicleId: String): String = "drive-score$DRIVING_KEY_SEP$vehicleId"

/** Cache/feed key for [DrivingRepository.drivingStats] — the web `drivingKeys.stats(vid)` (`['driving-stats', vid]`). */
public fun drivingStatsKey(vehicleId: String): String = "driving-stats$DRIVING_KEY_SEP$vehicleId"

/** Cache/feed key for [DrivingRepository.drivingDynamics] — the web `drivingKeys.dynamics(vid)` (`['driving-dynamics', vid]`). */
public fun drivingDynamicsKey(vehicleId: String): String = "driving-dynamics$DRIVING_KEY_SEP$vehicleId"

/**
 * Cache/feed key for [DrivingRepository.accelerationDistribution] — the web
 * `drivingKeys.accelerationDistribution(vid)` (`['acceleration-distribution', vid]`).
 */
public fun accelerationDistributionKey(vehicleId: String): String = "acceleration-distribution$DRIVING_KEY_SEP$vehicleId"

/** Cache/feed key for [DrivingRepository.drivetrainHealth] — the web `drivingKeys.drivetrainHealth(vid)` (`['drivetrain-health', vid]`). */
public fun drivetrainHealthKey(vehicleId: String): String = "drivetrain-health$DRIVING_KEY_SEP$vehicleId"

/** Cache/feed key for [DrivingRepository.speedProfile] — the web `['speed-profile', vid, start, end]` tuple. */
public fun speedProfileKey(
    vehicleId: String,
    start: String?,
    end: String?,
): String = driveRangeKey("speed-profile", vehicleId, start, end)

/** Cache/feed key for [DrivingRepository.regenEfficiency] — the web `['regen-efficiency', vid, start, end]` tuple. */
public fun regenEfficiencyKey(
    vehicleId: String,
    start: String?,
    end: String?,
): String = driveRangeKey("regen-efficiency", vehicleId, start, end)

/** Cache/feed key for [DrivingRepository.routeEfficiency] — the web `['route-efficiency', vid, start, end]` tuple. */
public fun routeEfficiencyKey(
    vehicleId: String,
    start: String?,
    end: String?,
): String = driveRangeKey("route-efficiency", vehicleId, start, end)

/** Cache/feed key for [DrivingRepository.drivePositions] — the web `['drive-positions', driveId]` tuple. */
public fun drivePositionsKey(driveId: String): String = "drive-positions$DRIVING_KEY_SEP$driveId"

/** Cache/feed key for [DrivingRepository.driveTelemetry] — the web `['drive-telemetry', driveId]` tuple. */
public fun driveTelemetryKey(driveId: String): String = "drive-telemetry$DRIVING_KEY_SEP$driveId"

/** Cache/feed key for [DrivingRepository.drivingCoach] — the web `drivingKeys.coach(vid, days)` (`['driving-coach', vid, days]`). */
public fun drivingCoachKey(
    vehicleId: String,
    days: Int,
): String = listOf("driving-coach", vehicleId, days.toString()).joinToString(DRIVING_KEY_SEP)

/** Cache/feed key for [DrivingRepository.geocodeSearch] — the web `['geocode-search', query]` tuple. */
public fun geocodeSearchKey(query: String): String = "geocode-search$DRIVING_KEY_SEP$query"

/**
 * Cache/feed key for [DrivingRepository.driveWhyEnded] — the web `drivingKeys.whyEnded(id, window)`
 * (`['drive', id, 'why-ended', window]`). Note it is built under the [DRIVE_FAMILY] head, so the
 * bulk-delete `['drive']` invalidation matches it under [drivingKeyInFamily].
 */
public fun driveWhyEndedKey(
    driveId: String,
    window: String,
): String = listOf(DRIVE_FAMILY, driveId, "why-ended", window).joinToString(DRIVING_KEY_SEP)

/** Shared builder for the `[head, vid, start, end]` analytics-range key tuple (null range slots collapse to ""). */
private fun driveRangeKey(
    head: String,
    vehicleId: String,
    start: String?,
    end: String?,
): String = listOf(head, vehicleId, start ?: "", end ?: "").joinToString(DRIVING_KEY_SEP)

/**
 * `true` when [key] belongs to the [family] under TanStack prefix-invalidation semantics: the key
 * either equals the family head exactly OR descends from it (`family` + separator + …). The
 * separator boundary keeps the singular `drive` family from matching the plural `drives` lists or
 * the `drive-score`/`drive-positions`/`drive-telemetry` siblings. Mirrors
 * `invalidateQueries({ queryKey: [family] })`. Locked by golden vectors shared with the C# port.
 */
public fun drivingKeyInFamily(
    key: String,
    family: String,
): Boolean = key == family || key.startsWith("$family$DRIVING_KEY_SEP")
