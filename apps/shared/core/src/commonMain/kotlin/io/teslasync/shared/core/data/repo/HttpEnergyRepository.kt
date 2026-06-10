package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [EnergyRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.Energy] partition, keyed by a stable
 * per-feed string ([energyStatsKey] etc.) that mirrors the web TanStack query keys, so a feed is
 * cached independently while logout still clears the whole domain in one call.
 *
 * Because the domain has many distinct read shapes with no generated DTO, the cache layer stores
 * each feed's raw [JsonElement] (the verbatim-SI strategy of the Analytics/Charging/Driving ports)
 * via [CachingRepository] of [JsonElement]. The six list reads apply [safeArray] before the cache
 * write — exactly the web `select: safeArray` derivation, performed once at the data layer.
 *
 * The seven mutations call the API directly and return a non-throwing [Result]. They do NOT evict
 * the durable cache: the cache-then-network operator always re-fetches when the S8 store bumps the
 * affected family's triggers (the `invalidateQueries` analogue), so the previous rows stay visible
 * during the reload while no stale value is ever served as fresh. Energy/power/capacity values stay
 * SI (Wh, W, meters, °C) through the cache; conversion is the render boundary's job (S5).
 */
public class HttpEnergyRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    EnergyRepository {
    override val domain: CacheDomain = CacheDomain.Energy

    // ---- Reads --------------------------------------------------------------------

    override fun energyStats(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> =
        observe(energyStatsKey(vehicleId, days)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/energy", query = energyStatsQuery(days))
        }

    override fun batteryHealth(
        vehicleId: String,
        asOf: String?,
    ): Flow<Resource<JsonElement>> =
        observe(batteryHealthKey(vehicleId, asOf)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/battery", query = batteryHealthQuery(asOf))
        }

    override fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(batteryCellsKey(vehicleId)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/battery/cells")
        }

    override fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(batteryHealthAnalyticsKey(vehicleId)) {
            api.request<JsonElement>(path = "/analytics/battery-health", query = energyVehicleIdQuery(vehicleId))
        }

    override fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(batteryDegradationKey(vehicleId)) {
            api.request<JsonElement>(path = "/analytics/battery-degradation", query = energyVehicleIdQuery(vehicleId))
        }

    override fun energyFlow(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(energyFlowKey(vehicleId)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/energy/flow")
        }

    override fun vampireDrainStats(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(vampireDrainStatsKey(vehicleId)) {
            api.request<JsonElement>(path = "/vampire-drain/stats", query = energyVehicleIdQuery(vehicleId))
        }

    override fun vampireDrainEvents(
        vehicleId: String,
        limit: Int,
    ): Flow<Resource<JsonElement>> =
        observe(vampireDrainEventsKey(vehicleId, limit)) {
            safeArray(api.request<JsonElement>(path = "/vampire-drain", query = vampireDrainEventsQuery(vehicleId, limit)))
        }

    override fun projectedRange(vehicleId: String): Flow<Resource<JsonElement>> =
        observe(projectedRangeKey(vehicleId)) {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/battery/projected-range")
        }

    override fun sleepEfficiency(
        vehicleId: String,
        days: Int,
        startDate: String?,
        endDate: String?,
    ): Flow<Resource<JsonElement>> =
        observe(sleepEfficiencyKey(vehicleId, days, startDate, endDate)) {
            api.request<JsonElement>(path = "/analytics/sleep", query = sleepEfficiencyQuery(vehicleId, days, startDate, endDate))
        }

    override fun teslaEnergySites(): Flow<Resource<JsonElement>> =
        observe(teslaEnergySitesKey()) {
            safeArray(api.request<JsonElement>(path = "/tesla/energy-sites"))
        }

    override fun teslaEnergySiteInfo(siteId: Long): Flow<Resource<JsonElement>> =
        observe(teslaSiteInfoKey(siteId)) {
            api.request<JsonElement>(path = "/tesla/energy-sites/$siteId/site-info")
        }

    override fun teslaEnergyHistory(
        siteId: Long,
        period: String,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> =
        observe(teslaEnergyHistoryKey(siteId, period, since, until)) {
            safeArray(
                api.request<JsonElement>(
                    path = "/tesla/energy-sites/$siteId/energy-history",
                    query = teslaEnergyHistoryQuery(period, since, until),
                ),
            )
        }

    override fun teslaBackupHistory(
        siteId: Long,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> =
        observe(teslaBackupHistoryKey(siteId, since, until)) {
            safeArray(
                api.request<JsonElement>(
                    path = "/tesla/energy-sites/$siteId/backup-history",
                    query = teslaWindowQuery(since, until),
                ),
            )
        }

    override fun teslaWcChargingHistory(
        siteId: Long,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> =
        observe(teslaWcChargingHistoryKey(siteId, since, until)) {
            safeArray(
                api.request<JsonElement>(
                    path = "/tesla/energy-sites/$siteId/charging-history",
                    query = teslaWindowQuery(since, until),
                ),
            )
        }

    override fun teslaEnergyLiveStatus(siteId: Long): Flow<Resource<JsonElement>> =
        observe(teslaLiveStatusKey(siteId)) {
            api.request<JsonElement>(path = "/tesla/energy-sites/$siteId/live-status")
        }

    override fun teslaEnergyLiveStatusHistory(
        siteId: Long,
        since: String?,
        until: String?,
        limit: Int?,
    ): Flow<Resource<JsonElement>> =
        observe(teslaLiveStatusHistoryKey(siteId, since, until, limit)) {
            safeArray(
                api.request<JsonElement>(
                    path = "/tesla/energy-sites/$siteId/live-status/history",
                    query = teslaLiveStatusHistoryQuery(since, until, limit),
                ),
            )
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun refreshTeslaEnergySites(): Result<JsonElement> =
        api.safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/tesla/energy-sites/refresh")

    override suspend fun refreshTeslaEnergySiteInfo(siteId: Long): Result<JsonElement> =
        api.safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/tesla/energy-sites/$siteId/site-info/refresh")

    override suspend fun updateTouSettings(
        siteId: Long,
        settings: JsonObject,
    ): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/tesla/energy-sites/$siteId/tou-settings",
            body = settings,
        )

    override suspend fun refreshTeslaEnergyHistory(
        siteId: Long,
        period: String,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/tesla/energy-sites/$siteId/energy-history/refresh",
            query = teslaHistoryRefreshQuery(period, startDate, endDate, timeZone),
        )

    override suspend fun refreshTeslaBackupHistory(
        siteId: Long,
        period: String,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/tesla/energy-sites/$siteId/backup-history/refresh",
            query = teslaHistoryRefreshQuery(period, startDate, endDate, timeZone),
        )

    override suspend fun refreshTeslaWcChargingHistory(
        siteId: Long,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/tesla/energy-sites/$siteId/charging-history/refresh",
            query = teslaWcChargingRefreshQuery(startDate, endDate, timeZone),
        )

    override suspend fun refreshTeslaEnergyLiveStatus(siteId: Long): Result<JsonElement> =
        api.safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/tesla/energy-sites/$siteId/live-status/refresh")
}
