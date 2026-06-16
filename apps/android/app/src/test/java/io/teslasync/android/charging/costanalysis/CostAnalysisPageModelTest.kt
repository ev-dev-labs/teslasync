@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.costanalysis

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * Off-device unit coverage for the framework-free CostAnalysisPage model — the native fold of the web page's
 * `useCostAnalysisData` derivation (coreStats / monthlyData / costPerKwhTrend / chargerTypeData / hourlyData +
 * touInsights / lifetimeMetrics), the session-level helpers (categorizeCharger / durationMinutes / distanceAddedM),
 * and the `/analytics/cost-forecast` JSON parsing. Pure functions only, so the whole derivation is pinned without a
 * Compose host or the network.
 */
class CostAnalysisPageModelTest {
    private val utc = ZoneId.of("UTC")
    private val locale: Locale = Locale.US

    private fun session(
        id: Long,
        started: String,
        ended: String? = null,
        energyWh: Double? = null,
        cost: Double? = null,
        chargerType: String? = null,
        peakW: Double? = null,
        place: String? = null,
        startOdo: Double? = null,
        endOdo: Double? = null,
    ): ChargingSession =
        ChargingSession(
            id = id,
            startedAt = Instant.parse(started),
            vehicleId = 1L,
            avgPowerW = null,
            cableType = null,
            chargerType = chargerType,
            costCurrency = null,
            costDecimal = cost,
            deltaSocPct = null,
            endOdometerM = endOdo,
            endSocPct = null,
            endedAt = ended?.let { Instant.parse(it) },
            peakPowerW = peakW,
            startLat = null,
            startLng = null,
            startOdometerM = startOdo,
            startPlace = place,
            startSocPct = null,
            totalEnergyAddedWh = energyWh,
        )

    private fun derive(
        sessions: List<ChargingSession>,
        isMiles: Boolean = false,
    ): CostAnalysisData = deriveCostAnalysisData(sessions, isMiles, utc, locale)

    @Test
    fun emptySessionsYieldNullStatsAndEmptyCollections() {
        val data = derive(emptyList())
        assertNull(data.summaryStats)
        assertNull(data.lifetimeCoreStats)
        assertNull(data.lifetimeMetrics)
        assertNull(data.environmental)
        assertNull(data.savingsBaseStats)
        assertTrue(data.monthlyPoints.isEmpty())
        assertTrue(data.monthlyBuckets.isEmpty())
        assertTrue(data.costPerKwhTrend.isEmpty())
        assertTrue(data.chargerTypeData.isEmpty())
        assertTrue(data.timeOfUse.hourlyData.isEmpty())
        assertNull(data.timeOfUse.insights)
        assertEquals(1.0, data.chargerTotalCost, 0.0)
    }

    @Test
    fun coreStatsSumCostAndConvertEnergyToKwh() {
        val data =
            derive(
                listOf(
                    session(1, "2024-01-15T10:00:00Z", energyWh = 12_000.0, cost = 10.0),
                    session(2, "2024-01-20T10:00:00Z", energyWh = 8_000.0, cost = 6.0),
                ),
            )
        val stats = data.summaryStats!!
        assertEquals(16.0, stats.totalCost, 1e-9)
        assertEquals(20.0, stats.totalEnergy, 1e-9) // (12000 + 8000) Wh -> kWh
        assertEquals(2, stats.count)
        assertEquals(16.0 / 20.0, stats.avgCostPerKwh, 1e-9)
        // gallonsEquiv = 20 / 33.7; savings = gallonsEquiv * 3.5 - 16
        assertEquals(20.0 / 33.7, stats.gallonsEquiv, 1e-9)
        assertEquals(20.0 / 33.7 * DEFAULT_GAS_PRICE - 16.0, stats.savings, 1e-9)
    }

    @Test
    fun monthlyBucketsGroupedSortedAndMirroredAsPoints() {
        val data =
            derive(
                listOf(
                    session(1, "2024-02-10T10:00:00Z", energyWh = 10_000.0, cost = 5.0),
                    session(2, "2024-01-10T10:00:00Z", energyWh = 20_000.0, cost = 8.0),
                    session(3, "2024-01-25T10:00:00Z", energyWh = 10_000.0, cost = 4.0),
                ),
            )
        assertEquals(listOf("2024-01", "2024-02"), data.monthlyBuckets.map { it.month })
        val jan = data.monthlyBuckets.first()
        assertEquals(12.0, jan.cost, 1e-9)
        assertEquals(30.0, jan.energy, 1e-9) // 30000 Wh -> kWh
        assertEquals(2L, jan.sessions)
        assertEquals(12.0 / 30.0, jan.avgCostPerKwh, 1e-9)
        // chart points mirror month + cost
        assertEquals(data.monthlyBuckets.map { it.month }, data.monthlyPoints.map { it.month })
        assertEquals(12.0, data.monthlyPoints.first().cost, 1e-9)
    }

    @Test
    fun costPerKwhTrendFiltersUnpricedAndSortsByTime() {
        val data =
            derive(
                listOf(
                    session(1, "2024-03-10T10:00:00Z", energyWh = 10_000.0, cost = 3.0),
                    session(2, "2024-01-10T10:00:00Z", energyWh = 10_000.0, cost = 2.0),
                    session(3, "2024-02-10T10:00:00Z", energyWh = 0.0, cost = 1.0), // no energy -> dropped
                    session(4, "2024-02-15T10:00:00Z", energyWh = 5_000.0, cost = null), // no cost -> dropped
                ),
            )
        // only sessions 1 & 2 survive, sorted ascending by start time -> session 2 then 1
        assertEquals(2, data.costPerKwhTrend.size)
        assertEquals(2.0 / 10.0, data.costPerKwhTrend[0].costPerKwh, 1e-9)
        assertEquals(3.0 / 10.0, data.costPerKwhTrend[1].costPerKwh, 1e-9)
    }

    @Test
    fun chargerTypeDataCategorizesAndSortsByCostDescending() {
        val data =
            derive(
                listOf(
                    session(1, "2024-01-10T10:00:00Z", energyWh = 10_000.0, cost = 2.0, place = "Home"),
                    session(2, "2024-01-11T10:00:00Z", energyWh = 10_000.0, cost = 9.0, chargerType = "Tesla Supercharger"),
                    session(3, "2024-01-12T10:00:00Z", energyWh = 10_000.0, cost = 5.0, peakW = 50_000.0),
                ),
            )
        assertEquals(listOf("Supercharger", "Public DC", "Home"), data.chargerTypeData.map { it.name })
        assertEquals(9.0, data.chargerTypeData.first().cost, 1e-9)
        assertEquals(10.0, data.chargerTypeData.first().energyKwh, 1e-9)
        assertEquals(1L, data.chargerTypeData.first().sessions)
    }

    @Test
    fun timeOfUseHasTwentyFourBucketsWithInsights() {
        val data =
            derive(
                listOf(
                    session(1, "2024-01-10T02:00:00Z", energyWh = 5_000.0, cost = 1.0), // off-peak (02:00)
                    session(2, "2024-01-10T02:30:00Z", energyWh = 5_000.0, cost = 1.0), // off-peak, busiest hour 2
                    session(3, "2024-01-10T15:00:00Z", energyWh = 5_000.0, cost = 8.0), // peak 15:00, priciest
                ),
            )
        assertEquals(24, data.timeOfUse.hourlyData.size)
        val insights = data.timeOfUse.insights!!
        assertEquals(2, insights.cheapest.hour) // hour 2 avg cost 1.0 < hour 15 avg 8.0
        assertEquals(15, insights.priciest.hour)
        assertEquals(2, insights.busiest.hour) // two sessions in hour 2
        assertEquals(2.0 / 3.0 * 100.0, insights.offPeakPct, 1e-9) // 2 of 3 sessions in 10pm-6am
    }

    @Test
    fun lifetimeMetricsAverageAndCountFreeSessions() {
        val data =
            derive(
                listOf(
                    session(1, "2024-01-10T10:00:00Z", energyWh = 10_000.0, cost = 10.0),
                    session(2, "2024-01-11T10:00:00Z", energyWh = 30_000.0, cost = 0.0), // free
                    session(3, "2024-01-12T10:00:00Z", energyWh = 20_000.0, cost = null), // free (null cost)
                ),
            )
        val m = data.lifetimeMetrics!!
        assertEquals(10.0 / 3.0, m.avgSessionCost, 1e-9)
        assertEquals(60.0 / 3.0, m.avgSessionEnergy, 1e-9) // total energy 60 kWh / 3
        assertEquals(2.0, m.freeCount, 0.0)
        assertEquals(50.0, m.freeEnergy, 1e-9) // (30000 + 20000) Wh -> 50 kWh (feature-view kWh contract)
    }

    @Test
    fun environmentalImpactDerivedFromCore() {
        val data = derive(listOf(session(1, "2024-01-10T10:00:00Z", energyWh = 33_700.0, cost = 5.0)))
        val env = data.environmental!!
        assertEquals(1.0, env.gallonsEquiv, 1e-9) // 33.7 kWh / 33.7
        assertTrue(env.co2SavedKg > 0.0)
        assertTrue(env.treeEquiv > 0.0)
    }

    @Test
    fun distanceUnitFollowsIsMilesPreference() {
        val sessions = listOf(session(1, "2024-01-10T10:00:00Z", energyWh = 10_000.0, cost = 5.0))
        assertEquals(DISTANCE_UNIT_KM, derive(sessions, isMiles = false).distanceUnit)
        assertEquals(DISTANCE_UNIT_MILES, derive(sessions, isMiles = true).distanceUnit)
    }

    @Test
    fun savingsBaseStatsCarryMonthCountAndDisplayDistance() {
        val data =
            derive(
                listOf(
                    session(1, "2024-01-10T10:00:00Z", energyWh = 10_000.0, cost = 5.0, startOdo = 0.0, endOdo = 1_609_344.0),
                    session(2, "2024-02-10T10:00:00Z", energyWh = 10_000.0, cost = 5.0),
                ),
                isMiles = false,
            )
        val base = data.savingsBaseStats!!
        assertEquals(20.0, base.totalEnergyKwh, 1e-9)
        assertEquals(10.0, base.totalCost, 1e-9)
        assertEquals(2, base.monthCount) // two distinct months
        // web toDistanceDisplay(totalDistanceM / 1609.344) for km = (1609344 / 1609.344) / 1000 = 1.0
        assertEquals(1.0, base.totalDistanceDisplay, 1e-6)
    }

    @Test
    fun categorizeChargerCoversEveryBranch() {
        assertEquals("Supercharger", categorizeCharger(session(1, "2024-01-10T10:00:00Z", chargerType = "tesla")))
        assertEquals("Public DC", categorizeCharger(session(2, "2024-01-10T10:00:00Z", peakW = 50_000.0)))
        assertEquals("Work / L2", categorizeCharger(session(3, "2024-01-10T10:00:00Z", place = "The Office")))
        assertEquals("Home", categorizeCharger(session(4, "2024-01-10T10:00:00Z", place = "Driveway")))
    }

    @Test
    fun durationMinutesRoundsAndGuardsOpenSessions() {
        assertEquals(30L, durationMinutes(session(1, "2024-01-10T10:00:00Z", ended = "2024-01-10T10:30:00Z")))
        assertEquals(0L, durationMinutes(session(2, "2024-01-10T10:00:00Z"))) // no ended_at
        assertEquals(0L, durationMinutes(session(3, "2024-01-10T10:30:00Z", ended = "2024-01-10T10:00:00Z"))) // negative
    }

    @Test
    fun distanceAddedMRequiresBothBoundsAndPositiveDelta() {
        assertEquals(500.0, distanceAddedM(session(1, "2024-01-10T10:00:00Z", startOdo = 1_000.0, endOdo = 1_500.0)))
        assertNull(distanceAddedM(session(2, "2024-01-10T10:00:00Z", startOdo = 1_000.0))) // missing end
        assertNull(distanceAddedM(session(3, "2024-01-10T10:00:00Z", startOdo = 1_500.0, endOdo = 1_000.0))) // negative
    }

    @Test
    fun parseForecastSectionMapsHistoricalAndForecastArrays() {
        val section = parseForecastSection(Json.parseToJsonElement(FORECAST_JSON))
        assertEquals(2, section.historical.size)
        assertEquals("2024-01", section.historical.first().month)
        assertEquals(10.0, section.historical.first().cost, 1e-9)
        assertEquals(0.2, section.historical.first().costPerKwh, 1e-9)
        assertEquals(1, section.forecast.size)
        assertEquals(13.0, section.forecast.first().cost, 1e-9)
        assertEquals(11.0, section.forecast.first().costLow, 1e-9)
        assertEquals(15.0, section.forecast.first().costHigh, 1e-9)
    }

    @Test
    fun parseForecastSectionNullYieldsEmpty() {
        val section = parseForecastSection(null)
        assertTrue(section.historical.isEmpty())
        assertTrue(section.forecast.isEmpty())
    }

    @Test
    fun parseForecastDetailsDeserializesBreakdownSavingsInsights() {
        val details = parseForecastDetails(Json.parseToJsonElement(FORECAST_JSON))
        assertEquals(70.0, details.breakdown.home.pct, 1e-9)
        assertEquals(0.4, details.breakdown.supercharger.avgCostPerKwh, 1e-9)
        assertEquals(60.0, details.gasComparison.monthlySavings, 1e-9)
        assertEquals(720.0, details.gasComparison.annualSavings, 1e-9)
        assertEquals(2, details.insights.size)
    }

    @Test
    fun parseForecastDetailsNullYieldsDefaults() {
        val details = parseForecastDetails(null)
        assertEquals(0.0, details.gasComparison.monthlySavings, 0.0)
        assertTrue(details.insights.isEmpty())
    }

    @Test
    fun recordOpenedEmitsPiiSafeSlug() {
        val logger = RecordingLogger()
        recordCostAnalysisPageOpened(logger)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "CostAnalysisPage"), opened.second)
    }

    @Test
    fun registrationMatchesNavDestination() {
        assertEquals("costAnalysis", CostAnalysisPageRegistration.ROUTE_ID)
        assertEquals("/cost-analysis", CostAnalysisPageRegistration.WEB_PATH)
        assertEquals(5000, CostAnalysisPageRegistration.SESSIONS_LIMIT)
        assertNotNull(CostAnalysisPageRegistration.SLUG)
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private companion object {
        const val FORECAST_JSON = """
            {
              "historical": [
                {"month":"2024-01","cost":10.0,"kwh":50.0,"sessions":3,"cost_per_kwh":0.2},
                {"month":"2024-02","cost":12.0,"kwh":60.0,"sessions":4,"cost_per_kwh":0.2}
              ],
              "forecast": [
                {"month":"2024-03","cost":13.0,"cost_low":11.0,"cost_high":15.0,"kwh":65.0}
              ],
              "breakdown": {
                "home": {"pct":70.0,"avg_cost_per_kwh":0.15,"monthly_avg":8.0},
                "supercharger": {"pct":30.0,"avg_cost_per_kwh":0.4,"monthly_avg":4.0}
              },
              "gas_comparison": {
                "avg_km_per_month":500.0,"gas_cost_per_month":80.0,"ev_cost_per_month":20.0,
                "monthly_savings":60.0,"annual_savings":720.0,"lifetime_savings":7200.0
              },
              "insights": ["You charge mostly at home.","Off-peak charging saves money."]
            }
        """
    }
}
