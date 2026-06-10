package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.teslasync.shared.core.cache.newTestCache
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Locks every [HttpEnergyRepository] read + mutation to the exact path, HTTP method and snake_case
 * query the web `useEnergy` hooks send. A captured [HttpRequestData] per call lets the assertions
 * pin the wire contract, so a path/param regression is caught at build time rather than as a silent
 * always-fails refresh in production. No real network is involved (Ktor `MockEngine`).
 */
class HttpEnergyRepositoryTest {
    private fun capture(
        body: String,
        call: suspend (HttpEnergyRepository) -> Unit,
    ): HttpRequestData {
        var captured: HttpRequestData? = null
        runTestBlocking {
            val engine =
                MockEngine { request ->
                    captured = request
                    respond(body, HttpStatusCode.OK, jsonHeaders)
                }
            val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
            call(HttpEnergyRepository(api, newTestCache().store))
        }
        return captured!!
    }

    private suspend fun drain(flow: Flow<Resource<*>>) {
        flow.toList()
    }

    private fun HttpRequestData.path(): String = url.encodedPath

    private fun HttpRequestData.param(key: String): String? = url.parameters[key]

    // ---- Reads --------------------------------------------------------------------

    @Test
    fun energyStatsHitsPerVehicleEnergyWithDays() {
        val req = capture("{}") { drain(it.energyStats("7", 14)) }
        assertEquals("/api/v1/vehicles/7/energy", req.path())
        assertEquals("14", req.param("days"))
    }

    @Test
    fun batteryHealthHitsPerVehicleBatteryAndAppendsAsOf() {
        val live = capture("{}") { drain(it.batteryHealth("7")) }
        assertEquals("/api/v1/vehicles/7/battery", live.path())
        assertEquals(null, live.param("as_of"))

        val asOf = capture("{}") { drain(it.batteryHealth("7", asOf = "2026-01-01T00:00:00Z")) }
        assertEquals("/api/v1/vehicles/7/battery", asOf.path())
        assertEquals("2026-01-01T00:00:00Z", asOf.param("as_of"))
    }

    @Test
    fun batteryCellsHitsPerVehicleBatteryCells() {
        val req = capture("{}") { drain(it.batteryCells("7")) }
        assertEquals("/api/v1/vehicles/7/battery/cells", req.path())
    }

    @Test
    fun batteryHealthAnalyticsHitsAnalyticsBatteryHealth() {
        val req = capture("{}") { drain(it.batteryHealthAnalytics("7")) }
        assertEquals("/api/v1/analytics/battery-health", req.path())
        assertEquals("7", req.param("vehicle_id"))
    }

    @Test
    fun batteryDegradationHitsAnalyticsBatteryDegradation() {
        val req = capture("{}") { drain(it.batteryDegradation("7")) }
        assertEquals("/api/v1/analytics/battery-degradation", req.path())
        assertEquals("7", req.param("vehicle_id"))
    }

    @Test
    fun energyFlowHitsPerVehicleEnergyFlow() {
        val req = capture("{}") { drain(it.energyFlow("7")) }
        assertEquals("/api/v1/vehicles/7/energy/flow", req.path())
    }

    @Test
    fun vampireDrainStatsHitsVampireDrainStats() {
        val req = capture("{}") { drain(it.vampireDrainStats("7")) }
        assertEquals("/api/v1/vampire-drain/stats", req.path())
        assertEquals("7", req.param("vehicle_id"))
    }

    @Test
    fun vampireDrainEventsHitsVampireDrainWithLimit() {
        val req = capture("[]") { drain(it.vampireDrainEvents("7", 25)) }
        assertEquals("/api/v1/vampire-drain", req.path())
        assertEquals("7", req.param("vehicle_id"))
        assertEquals("25", req.param("limit"))
    }

    @Test
    fun projectedRangeHitsPerVehicleProjectedRange() {
        val req = capture("{}") { drain(it.projectedRange("7")) }
        assertEquals("/api/v1/vehicles/7/battery/projected-range", req.path())
    }

    @Test
    fun sleepEfficiencyHitsAnalyticsSleepWithRange() {
        val req = capture("{}") { drain(it.sleepEfficiency("7", 30, "2026-01-01", "2026-02-01")) }
        assertEquals("/api/v1/analytics/sleep", req.path())
        assertEquals("7", req.param("vehicle_id"))
        assertEquals("30", req.param("days"))
        assertEquals("2026-01-01", req.param("start"))
        assertEquals("2026-02-01", req.param("end"))
    }

    @Test
    fun teslaEnergySitesHitsTeslaEnergySites() {
        val req = capture("[]") { drain(it.teslaEnergySites()) }
        assertEquals("/api/v1/tesla/energy-sites", req.path())
    }

    @Test
    fun teslaEnergySiteInfoHitsPerSiteSiteInfo() {
        val req = capture("{}") { drain(it.teslaEnergySiteInfo(5)) }
        assertEquals("/api/v1/tesla/energy-sites/5/site-info", req.path())
    }

    @Test
    fun teslaEnergyHistoryHitsPerSiteEnergyHistoryWithPeriod() {
        val req = capture("[]") { drain(it.teslaEnergyHistory(5, "week", "2026-01-01", null)) }
        assertEquals("/api/v1/tesla/energy-sites/5/energy-history", req.path())
        assertEquals("week", req.param("period"))
        assertEquals("2026-01-01", req.param("since"))
        assertEquals(null, req.param("until"))
    }

    @Test
    fun teslaBackupHistoryHitsPerSiteBackupHistory() {
        val req = capture("[]") { drain(it.teslaBackupHistory(5)) }
        assertEquals("/api/v1/tesla/energy-sites/5/backup-history", req.path())
        assertEquals(null, req.param("period"))
    }

    @Test
    fun teslaWcChargingHistoryHitsPerSiteChargingHistory() {
        val req = capture("[]") { drain(it.teslaWcChargingHistory(5)) }
        assertEquals("/api/v1/tesla/energy-sites/5/charging-history", req.path())
    }

    @Test
    fun teslaEnergyLiveStatusHitsPerSiteLiveStatus() {
        val req = capture("{}") { drain(it.teslaEnergyLiveStatus(5)) }
        assertEquals("/api/v1/tesla/energy-sites/5/live-status", req.path())
    }

    @Test
    fun teslaLiveStatusHistoryHitsPerSiteLiveStatusHistory() {
        val req = capture("[]") { drain(it.teslaEnergyLiveStatusHistory(5, "2026-01-01", "2026-02-01", 50)) }
        assertEquals("/api/v1/tesla/energy-sites/5/live-status/history", req.path())
        assertEquals("2026-01-01", req.param("since"))
        assertEquals("2026-02-01", req.param("until"))
        assertEquals("50", req.param("limit"))
    }

    // ---- Mutations ----------------------------------------------------------------

    @Test
    fun refreshSitesPostsToRefresh() {
        val req = capture("[]") { it.refreshTeslaEnergySites() }
        assertEquals("/api/v1/tesla/energy-sites/refresh", req.path())
        assertEquals("POST", req.method.value)
    }

    @Test
    fun refreshSiteInfoPostsToPerSiteRefresh() {
        val req = capture("{}") { it.refreshTeslaEnergySiteInfo(5) }
        assertEquals("/api/v1/tesla/energy-sites/5/site-info/refresh", req.path())
        assertEquals("POST", req.method.value)
    }

    @Test
    fun updateTouSettingsPostsToTouSettings() {
        val req = capture("{}") { it.updateTouSettings(5, JsonObject(emptyMap())) }
        assertEquals("/api/v1/tesla/energy-sites/5/tou-settings", req.path())
        assertEquals("POST", req.method.value)
    }

    @Test
    fun refreshEnergyHistoryPostsWithPeriodAndWindow() {
        val req = capture("{}") { it.refreshTeslaEnergyHistory(5, "day", "2026-01-01", "2026-02-01", "UTC") }
        assertEquals("/api/v1/tesla/energy-sites/5/energy-history/refresh", req.path())
        assertEquals("POST", req.method.value)
        assertEquals("day", req.param("period"))
        assertEquals("2026-01-01", req.param("start_date"))
        assertEquals("2026-02-01", req.param("end_date"))
        assertEquals("UTC", req.param("time_zone"))
    }

    @Test
    fun refreshBackupHistoryPostsWithPeriod() {
        val req = capture("{}") { it.refreshTeslaBackupHistory(5) }
        assertEquals("/api/v1/tesla/energy-sites/5/backup-history/refresh", req.path())
        assertEquals("POST", req.method.value)
        assertEquals("day", req.param("period"))
    }

    @Test
    fun refreshWcChargingHistoryPostsWithoutPeriod() {
        val req = capture("{}") { it.refreshTeslaWcChargingHistory(5, "2026-01-01", null, null) }
        assertEquals("/api/v1/tesla/energy-sites/5/charging-history/refresh", req.path())
        assertEquals("POST", req.method.value)
        assertEquals(null, req.param("period"))
        assertEquals("2026-01-01", req.param("start_date"))
    }

    @Test
    fun refreshLiveStatusPostsToPerSiteRefresh() {
        val req = capture("{}") { it.refreshTeslaEnergyLiveStatus(5) }
        assertEquals("/api/v1/tesla/energy-sites/5/live-status/refresh", req.path())
        assertEquals("POST", req.method.value)
    }
}
