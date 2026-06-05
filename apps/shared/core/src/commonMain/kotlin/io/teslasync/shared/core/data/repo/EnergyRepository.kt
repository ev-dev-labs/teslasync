package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The S7 data port for the Energy domain — the cross-platform analogue of the web `useEnergy`
 * hook domain (web/src/api/hooks/useEnergy.ts). Every native Energy / Battery / Tesla-Energy-Site
 * surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through
 * this interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The seventeen reads stream a cache-then-network [Resource] (ADR-013): the cached value first for
 * an instant cold start, then the refreshed value. Each is cached under a stable per-feed key
 * (see [energyStatsKey] etc.) mirroring the web TanStack query keys. None of these read shapes
 * (energy stats, battery health/cells/analytics/degradation, energy flow, vampire drain, projected
 * range, sleep efficiency, the Tesla energy-site catalog/info/history/live-status feeds) has a
 * generated SI DTO, so every read is carried verbatim as a raw SI [JsonElement] — the same
 * verbatim-SI strategy as the Analytics/Charging/Driving ports. The six list reads
 * (`useVampireDrainEvents`, `useTeslaEnergySites`, `useTeslaEnergyHistory`, `useTeslaBackupHistory`,
 * `useTeslaWCChargingHistory`, `useTeslaEnergyLiveStatusHistory`) apply the web `select: safeArray`
 * guard at the data layer.
 *
 * The seven mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT
 * touch the durable cache — the cache-then-network operator always re-fetches on the S8 store's
 * targeted family refresh (the `invalidateQueries` analogue), so the previous rows stay visible
 * during the reload while no stale value is ever served as fresh. Energy/power/capacity values are
 * SI on the wire (Wh, W, meters, °C) and stay SI through the cache; display conversion is the
 * render boundary's job (S5), never this layer's.
 *
 * The web `useEnergyFlow`/`useTeslaEnergyLiveStatus` `refetchInterval` live-poll cadences, the
 * `enabled` lazy gates, the per-read `staleTime` tiers and the mutation toasts are all render-layer
 * concerns and are intentionally NOT reproduced at this layer; a platform pull-to-refresh / live
 * cadence drives re-collection. The two deprecated vampire-drain reads (the backend routes were
 * removed and reliably 404) are ported verbatim for parity — their error surfaces gracefully as a
 * [Resource.Error] exactly as the web query error does.
 */
public interface EnergyRepository {
    // ---- Reads --------------------------------------------------------------------

    /**
     * `GET /vehicles/{vehicleId}/energy?days={days}` — the per-vehicle energy/efficiency summary
     * (web `useEnergyStats`, default 30 days). Cached under [energyStatsKey].
     */
    public fun energyStats(
        vehicleId: String,
        days: Int = DEFAULT_DAYS,
    ): Flow<Resource<JsonElement>>

    /**
     * `GET /vehicles/{vehicleId}/battery[?as_of={asOf}]` — current (or point-in-time) battery
     * health (web `useBatteryHealth`). When [asOf] is present the backend reroutes per-signal
     * `SignalAt` lookups through `signal_log`; the key then includes [asOf] so live and historical
     * reads cache independently (web parity). Cached under [batteryHealthKey].
     */
    public fun batteryHealth(
        vehicleId: String,
        asOf: String? = null,
    ): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{vehicleId}/battery/cells` — cell voltage/temperature summary (web `useBatteryCells`). */
    public fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /analytics/battery-health?vehicle_id={vehicleId}` — battery health analytics (web `useBatteryHealthAnalytics`). */
    public fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /analytics/battery-degradation?vehicle_id={vehicleId}` — degradation model (web `useBatteryDegradation`). */
    public fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{vehicleId}/energy/flow` — live energy-flow snapshot (web `useEnergyFlow`). */
    public fun energyFlow(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /vampire-drain/stats?vehicle_id={vehicleId}` — idle-drain stats (web `useVampireDrainStats`).
     * DEPRECATED: the backend route was removed and reliably 404s; ported verbatim for parity.
     */
    public fun vampireDrainStats(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /vampire-drain?vehicle_id={vehicleId}&limit={limit}` — idle-drain events
     * (web `useVampireDrainEvents`, default 50, `safeArray`-guarded). DEPRECATED: 404s; ported for
     * parity. Cached under [vampireDrainEventsKey].
     */
    public fun vampireDrainEvents(
        vehicleId: String,
        limit: Int = DEFAULT_VAMPIRE_LIMIT,
    ): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{vehicleId}/battery/projected-range` — projected-range model (web `useProjectedRange`). */
    public fun projectedRange(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /analytics/sleep?vehicle_id={vehicleId}&days={days}[&start][&end]` — sleep/sentry drain
     * efficiency (web `useSleepEfficiency`). When [startDate]/[endDate] are present they take
     * precedence over the rolling `days` window (web parity); `days` is still sent for backward
     * compatibility. Cached under [sleepEfficiencyKey].
     */
    public fun sleepEfficiency(
        vehicleId: String,
        days: Int = DEFAULT_DAYS,
        startDate: String? = null,
        endDate: String? = null,
    ): Flow<Resource<JsonElement>>

    /** `GET /tesla/energy-sites` — the discovered Tesla energy sites (web `useTeslaEnergySites`, `safeArray`). */
    public fun teslaEnergySites(): Flow<Resource<JsonElement>>

    /** `GET /tesla/energy-sites/{siteId}/site-info` — detailed site config (web `useTeslaEnergySiteInfo`). */
    public fun teslaEnergySiteInfo(siteId: Long): Flow<Resource<JsonElement>>

    /**
     * `GET /tesla/energy-sites/{siteId}/energy-history?period={period}[&since][&until]` — solar/
     * battery/grid energy history (web `useTeslaEnergyHistory`, default period `day`, `safeArray`).
     * Cached under [teslaEnergyHistoryKey].
     */
    public fun teslaEnergyHistory(
        siteId: Long,
        period: String = DEFAULT_PERIOD,
        since: String? = null,
        until: String? = null,
    ): Flow<Resource<JsonElement>>

    /**
     * `GET /tesla/energy-sites/{siteId}/backup-history[?since][&until]` — grid-outage backup events
     * (web `useTeslaBackupHistory`, `safeArray`). Cached under [teslaBackupHistoryKey].
     */
    public fun teslaBackupHistory(
        siteId: Long,
        since: String? = null,
        until: String? = null,
    ): Flow<Resource<JsonElement>>

    /**
     * `GET /tesla/energy-sites/{siteId}/charging-history[?since][&until]` — Wall Connector charging
     * history (web `useTeslaWCChargingHistory`, `safeArray`). Cached under [teslaWcChargingHistoryKey].
     */
    public fun teslaWcChargingHistory(
        siteId: Long,
        since: String? = null,
        until: String? = null,
    ): Flow<Resource<JsonElement>>

    /** `GET /tesla/energy-sites/{siteId}/live-status` — power-flow snapshot (web `useTeslaEnergyLiveStatus`). */
    public fun teslaEnergyLiveStatus(siteId: Long): Flow<Resource<JsonElement>>

    /**
     * `GET /tesla/energy-sites/{siteId}/live-status/history[?since][&until][&limit]` — power-flow
     * history (web `useTeslaEnergyLiveStatusHistory`, `safeArray`). The `limit` is sent only when
     * present AND non-zero (web `if (limit)` truthy guard). Cached under [teslaLiveStatusHistoryKey].
     */
    public fun teslaEnergyLiveStatusHistory(
        siteId: Long,
        since: String? = null,
        until: String? = null,
        limit: Int? = null,
    ): Flow<Resource<JsonElement>>

    // ---- Mutations ----------------------------------------------------------------

    /**
     * `POST /tesla/energy-sites/refresh` (web `useRefreshTeslaEnergySites`). The web hook
     * invalidates `['tesla-energy-sites']`, so the S8 store refreshes that family.
     */
    public suspend fun refreshTeslaEnergySites(): Result<JsonElement>

    /**
     * `POST /tesla/energy-sites/{siteId}/site-info/refresh` (web `useRefreshTeslaEnergySiteInfo`).
     * The web hook invalidates `['tesla-site-info', siteId]` — only that site — so the S8 store
     * refreshes exactly [teslaSiteInfoKey].
     */
    public suspend fun refreshTeslaEnergySiteInfo(siteId: Long): Result<JsonElement>

    /**
     * `POST /tesla/energy-sites/{siteId}/tou-settings` with the verbatim `tou_settings` body
     * (web `useUpdateTOUSettings`). The body is carried as a raw [JsonObject] for byte-for-byte
     * parity with the web `JSON.stringify(settings)` (the tariff content is open-ended). The web
     * hook invalidates `['tesla-site-info', siteId]`, so the S8 store refreshes that site only.
     */
    public suspend fun updateTouSettings(
        siteId: Long,
        settings: JsonObject,
    ): Result<JsonElement>

    /**
     * `POST /tesla/energy-sites/{siteId}/energy-history/refresh?period={period}[&start_date]
     * [&end_date][&time_zone]` (web `useRefreshTeslaEnergyHistory`). Invalidates the whole
     * `['tesla-energy-history']` family.
     */
    public suspend fun refreshTeslaEnergyHistory(
        siteId: Long,
        period: String = DEFAULT_PERIOD,
        startDate: String? = null,
        endDate: String? = null,
        timeZone: String? = null,
    ): Result<JsonElement>

    /**
     * `POST /tesla/energy-sites/{siteId}/backup-history/refresh?period={period}[&start_date]
     * [&end_date][&time_zone]` (web `useRefreshTeslaBackupHistory`). Invalidates the whole
     * `['tesla-backup-history']` family.
     */
    public suspend fun refreshTeslaBackupHistory(
        siteId: Long,
        period: String = DEFAULT_PERIOD,
        startDate: String? = null,
        endDate: String? = null,
        timeZone: String? = null,
    ): Result<JsonElement>

    /**
     * `POST /tesla/energy-sites/{siteId}/charging-history/refresh[?start_date][&end_date]
     * [&time_zone]` (web `useRefreshTeslaWCChargingHistory` — note: NO `period`). Invalidates the
     * whole `['tesla-wc-charging-history']` family.
     */
    public suspend fun refreshTeslaWcChargingHistory(
        siteId: Long,
        startDate: String? = null,
        endDate: String? = null,
        timeZone: String? = null,
    ): Result<JsonElement>

    /**
     * `POST /tesla/energy-sites/{siteId}/live-status/refresh` (web `useRefreshTeslaEnergyLiveStatus`).
     * The web hook invalidates BOTH `['tesla-live-status']` and `['tesla-live-status-history']`, so
     * the S8 store refreshes both families.
     */
    public suspend fun refreshTeslaEnergyLiveStatus(siteId: Long): Result<JsonElement>

    public companion object {
        /** The web `useEnergyStats(days = 30)` / `useSleepEfficiency(days = 30)` default. */
        public const val DEFAULT_DAYS: Int = 30

        /** The web `useVampireDrainEvents(limit = 50)` default. */
        public const val DEFAULT_VAMPIRE_LIMIT: Int = 50

        /** The web `useTeslaEnergyHistory(period = 'day')` / refresh-history default. */
        public const val DEFAULT_PERIOD: String = "day"
    }
}

// ---- Query builders (web param semantics, snake_case) -----------------------------

/**
 * The `/vehicles/{id}/energy` query (web `useEnergyStats`: `?days=${days}`). The `days` key is
 * unconditional. Locked by golden vectors shared with the C# port.
 */
public fun energyStatsQuery(days: Int): Map<String, String> = mapOf("days" to days.toString())

/**
 * The `/vehicles/{id}/battery` query (web `useBatteryHealth`). The `as_of` key is sent only when
 * present AND non-blank (the web `asOf ? … : …` ternary); the raw value is forwarded — percent
 * encoding is the HTTP client's job, mirroring the web `encodeURIComponent`. Locked by golden
 * vectors shared with the C# port.
 */
public fun batteryHealthQuery(asOf: String?): Map<String, String> {
    val query = linkedMapOf<String, String>()
    asOf?.takeIf { it.isNotEmpty() }?.let { query["as_of"] = it }
    return query
}

/**
 * The single-`vehicle_id` GET query shared by `useBatteryHealthAnalytics`/`useBatteryDegradation`/
 * `useVampireDrainStats` — the `vehicle_id` key is unconditional (these hooks are `enabled` only
 * with a vehicle). Locked by golden vectors shared with the C# port.
 */
public fun energyVehicleIdQuery(vehicleId: String): Map<String, String> = mapOf("vehicle_id" to vehicleId)

/**
 * The `/vampire-drain` query (web `useVampireDrainEvents`: `?vehicle_id=${vehicleId}&limit=${limit}`).
 * Both keys are unconditional. Locked by golden vectors shared with the C# port.
 */
public fun vampireDrainEventsQuery(
    vehicleId: String,
    limit: Int,
): Map<String, String> =
    linkedMapOf(
        "vehicle_id" to vehicleId,
        "limit" to limit.toString(),
    )

/**
 * The `/analytics/sleep` query (web `useSleepEfficiency`). `vehicle_id` and `days` are
 * unconditional; `start`/`end` are appended together only when BOTH are present AND non-blank
 * (mirroring the web `startDate && endDate ? '&start=…&end=…' : ''` guard). Locked by golden
 * vectors shared with the C# port.
 */
public fun sleepEfficiencyQuery(
    vehicleId: String,
    days: Int,
    startDate: String?,
    endDate: String?,
): Map<String, String> {
    val query =
        linkedMapOf(
            "vehicle_id" to vehicleId,
            "days" to days.toString(),
        )
    if (!startDate.isNullOrEmpty() && !endDate.isNullOrEmpty()) {
        query["start"] = startDate
        query["end"] = endDate
    }
    return query
}

/**
 * The `/tesla/energy-sites/{id}/energy-history` query (web `useTeslaEnergyHistory`). `period` is
 * unconditional; `since`/`until` are appended only when present AND non-blank (the web `if (since)`
 * truthy guard). Locked by golden vectors shared with the C# port.
 */
public fun teslaEnergyHistoryQuery(
    period: String,
    since: String?,
    until: String?,
): Map<String, String> {
    val query = linkedMapOf("period" to period)
    if (!since.isNullOrEmpty()) query["since"] = since
    if (!until.isNullOrEmpty()) query["until"] = until
    return query
}

/**
 * The `since`/`until`-only window query shared by `useTeslaBackupHistory` and
 * `useTeslaWCChargingHistory`. Each key is appended only when present AND non-blank. Locked by
 * golden vectors shared with the C# port.
 */
public fun teslaWindowQuery(
    since: String?,
    until: String?,
): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (!since.isNullOrEmpty()) query["since"] = since
    if (!until.isNullOrEmpty()) query["until"] = until
    return query
}

/**
 * The `/tesla/energy-sites/{id}/live-status/history` query (web `useTeslaEnergyLiveStatusHistory`).
 * `since`/`until` are appended when present AND non-blank; `limit` is appended only when present
 * AND non-zero (the web `if (limit)` truthy guard, where `0` is falsy). Locked by golden vectors
 * shared with the C# port.
 */
public fun teslaLiveStatusHistoryQuery(
    since: String?,
    until: String?,
    limit: Int?,
): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (!since.isNullOrEmpty()) query["since"] = since
    if (!until.isNullOrEmpty()) query["until"] = until
    limit?.takeIf { it != 0 }?.let { query["limit"] = it.toString() }
    return query
}

/**
 * The `energy-history`/`backup-history` refresh query (web `useRefreshTeslaEnergyHistory` /
 * `useRefreshTeslaBackupHistory`). `period` is unconditional; `start_date`/`end_date`/`time_zone`
 * are appended only when present AND non-blank (the web `if (start_date)` truthy guards). Locked by
 * golden vectors shared with the C# port.
 */
public fun teslaHistoryRefreshQuery(
    period: String,
    startDate: String?,
    endDate: String?,
    timeZone: String?,
): Map<String, String> {
    val query = linkedMapOf("period" to period)
    if (!startDate.isNullOrEmpty()) query["start_date"] = startDate
    if (!endDate.isNullOrEmpty()) query["end_date"] = endDate
    if (!timeZone.isNullOrEmpty()) query["time_zone"] = timeZone
    return query
}

/**
 * The Wall-Connector charging-history refresh query (web `useRefreshTeslaWCChargingHistory`). Unlike
 * the energy/backup refreshes this sends NO `period`; `start_date`/`end_date`/`time_zone` are
 * appended only when present AND non-blank. Locked by golden vectors shared with the C# port.
 */
public fun teslaWcChargingRefreshQuery(
    startDate: String?,
    endDate: String?,
    timeZone: String?,
): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (!startDate.isNullOrEmpty()) query["start_date"] = startDate
    if (!endDate.isNullOrEmpty()) query["end_date"] = endDate
    if (!timeZone.isNullOrEmpty()) query["time_zone"] = timeZone
    return query
}

// ---- Cache/feed keys (mirror the web TanStack query keys) --------------------------

/** The tuple separator used by every Energy cache key, so family invalidation is boundary-safe. */
internal const val ENERGY_KEY_SEP: String = "|"

/** The `['tesla-energy-sites']` family — the discovered-sites catalog. */
public const val TESLA_ENERGY_SITES_FAMILY: String = "tesla-energy-sites"

/** The `['tesla-site-info']` family head — per-site detailed config (invalidated per `siteId`). */
public const val TESLA_SITE_INFO_FAMILY: String = "tesla-site-info"

/** The `['tesla-energy-history']` family — per-site solar/battery/grid energy history. */
public const val TESLA_ENERGY_HISTORY_FAMILY: String = "tesla-energy-history"

/** The `['tesla-backup-history']` family — per-site grid-outage backup events. */
public const val TESLA_BACKUP_HISTORY_FAMILY: String = "tesla-backup-history"

/** The `['tesla-wc-charging-history']` family — per-site Wall Connector charging history. */
public const val TESLA_WC_CHARGING_HISTORY_FAMILY: String = "tesla-wc-charging-history"

/** The `['tesla-live-status']` family — per-site power-flow snapshots. */
public const val TESLA_LIVE_STATUS_FAMILY: String = "tesla-live-status"

/** The `['tesla-live-status-history']` family — per-site power-flow history. */
public const val TESLA_LIVE_STATUS_HISTORY_FAMILY: String = "tesla-live-status-history"

/** Cache/feed key for [EnergyRepository.energyStats] — the web `['energy-stats', vid, days]` tuple. */
public fun energyStatsKey(
    vehicleId: String,
    days: Int,
): String = listOf("energy-stats", vehicleId, days.toString()).joinToString(ENERGY_KEY_SEP)

/**
 * Cache/feed key for [EnergyRepository.batteryHealth] — the web `['battery-health', vid]` (live) or
 * `['battery-health', vid, asOf]` (point-in-time) tuple. A null/blank [asOf] collapses to the live
 * key so live and historical reads cache independently.
 */
public fun batteryHealthKey(
    vehicleId: String,
    asOf: String?,
): String =
    asOf
        ?.takeIf { it.isNotEmpty() }
        ?.let { listOf("battery-health", vehicleId, it).joinToString(ENERGY_KEY_SEP) }
        ?: "battery-health$ENERGY_KEY_SEP$vehicleId"

/** Cache/feed key for [EnergyRepository.batteryCells] — the web `['battery-cells', vid]` tuple. */
public fun batteryCellsKey(vehicleId: String): String = "battery-cells$ENERGY_KEY_SEP$vehicleId"

/** Cache/feed key for [EnergyRepository.batteryHealthAnalytics] — the web `['battery-health-analytics', vid]` tuple. */
public fun batteryHealthAnalyticsKey(vehicleId: String): String = "battery-health-analytics$ENERGY_KEY_SEP$vehicleId"

/** Cache/feed key for [EnergyRepository.batteryDegradation] — the web `['battery-degradation', vid]` tuple. */
public fun batteryDegradationKey(vehicleId: String): String = "battery-degradation$ENERGY_KEY_SEP$vehicleId"

/** Cache/feed key for [EnergyRepository.energyFlow] — the web `['energy-flow', vid]` tuple. */
public fun energyFlowKey(vehicleId: String): String = "energy-flow$ENERGY_KEY_SEP$vehicleId"

/** Cache/feed key for [EnergyRepository.vampireDrainStats] — the web `['vampire-drain-stats', vid]` tuple. */
public fun vampireDrainStatsKey(vehicleId: String): String = "vampire-drain-stats$ENERGY_KEY_SEP$vehicleId"

/** Cache/feed key for [EnergyRepository.vampireDrainEvents] — the web `['vampire-drain-events', vid, limit]` tuple. */
public fun vampireDrainEventsKey(
    vehicleId: String,
    limit: Int,
): String = listOf("vampire-drain-events", vehicleId, limit.toString()).joinToString(ENERGY_KEY_SEP)

/** Cache/feed key for [EnergyRepository.projectedRange] — the web `['projected-range', vid]` tuple. */
public fun projectedRangeKey(vehicleId: String): String = "projected-range$ENERGY_KEY_SEP$vehicleId"

/** Cache/feed key for [EnergyRepository.sleepEfficiency] — the web `['sleep-efficiency', vid, days, start, end]` tuple. */
public fun sleepEfficiencyKey(
    vehicleId: String,
    days: Int,
    startDate: String?,
    endDate: String?,
): String =
    listOf(
        "sleep-efficiency",
        vehicleId,
        days.toString(),
        startDate ?: "",
        endDate ?: "",
    ).joinToString(ENERGY_KEY_SEP)

/** Cache/feed key for [EnergyRepository.teslaEnergySites] — the web `['tesla-energy-sites']` family key. */
public fun teslaEnergySitesKey(): String = TESLA_ENERGY_SITES_FAMILY

/** Cache/feed key for [EnergyRepository.teslaEnergySiteInfo] — the web `['tesla-site-info', siteId]` tuple. */
public fun teslaSiteInfoKey(siteId: Long): String = "$TESLA_SITE_INFO_FAMILY$ENERGY_KEY_SEP$siteId"

/** Cache/feed key for [EnergyRepository.teslaEnergyHistory] — the web `['tesla-energy-history', siteId, period, since, until]` tuple. */
public fun teslaEnergyHistoryKey(
    siteId: Long,
    period: String,
    since: String?,
    until: String?,
): String =
    listOf(
        TESLA_ENERGY_HISTORY_FAMILY,
        siteId.toString(),
        period,
        since ?: "",
        until ?: "",
    ).joinToString(ENERGY_KEY_SEP)

/** Cache/feed key for [EnergyRepository.teslaBackupHistory] — the web `['tesla-backup-history', siteId, since, until]` tuple. */
public fun teslaBackupHistoryKey(
    siteId: Long,
    since: String?,
    until: String?,
): String =
    listOf(
        TESLA_BACKUP_HISTORY_FAMILY,
        siteId.toString(),
        since ?: "",
        until ?: "",
    ).joinToString(ENERGY_KEY_SEP)

/** Cache/feed key for [EnergyRepository.teslaWcChargingHistory] — the web `['tesla-wc-charging-history', siteId, since, until]` tuple. */
public fun teslaWcChargingHistoryKey(
    siteId: Long,
    since: String?,
    until: String?,
): String =
    listOf(
        TESLA_WC_CHARGING_HISTORY_FAMILY,
        siteId.toString(),
        since ?: "",
        until ?: "",
    ).joinToString(ENERGY_KEY_SEP)

/** Cache/feed key for [EnergyRepository.teslaEnergyLiveStatus] — the web `['tesla-live-status', siteId]` tuple. */
public fun teslaLiveStatusKey(siteId: Long): String = "$TESLA_LIVE_STATUS_FAMILY$ENERGY_KEY_SEP$siteId"

/** Cache/feed key for [EnergyRepository.teslaEnergyLiveStatusHistory] — the web `['tesla-live-status-history', siteId, since, until, limit]` tuple. */
public fun teslaLiveStatusHistoryKey(
    siteId: Long,
    since: String?,
    until: String?,
    limit: Int?,
): String =
    listOf(
        TESLA_LIVE_STATUS_HISTORY_FAMILY,
        siteId.toString(),
        since ?: "",
        until ?: "",
        limit?.toString() ?: "",
    ).joinToString(ENERGY_KEY_SEP)

/**
 * `true` when [key] belongs to the [family] under TanStack prefix-invalidation semantics: the key
 * either equals the family head exactly OR descends from it (`family` + separator + …). The
 * separator boundary keeps `tesla-live-status` from matching the `tesla-live-status-history`
 * siblings, and keeps a per-site `tesla-site-info|{id}` refresh from touching another site. Mirrors
 * `invalidateQueries({ queryKey: [family] })`. Locked by golden vectors shared with the C# port.
 */
public fun energyKeyInFamily(
    key: String,
    family: String,
): Boolean = key == family || key.startsWith("$family$ENERGY_KEY_SEP")
