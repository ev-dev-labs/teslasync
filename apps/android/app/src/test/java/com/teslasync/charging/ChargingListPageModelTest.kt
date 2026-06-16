@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.charginglist

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import kotlin.time.Instant

/**
 * Off-device unit coverage for the framework-free ChargingListPage model — the native fold of the web page's
 * aggregation (`computeChargingPeriodStats`, `detectChargingAnomalies`, `dailyChargingTrend`, the collection /
 * search / sort / pagination pipeline, and the conditional-section `compute*` helpers). Pure functions only, so
 * the whole derivation is pinned without a Compose host or the network.
 */
class ChargingListPageModelTest {
    private val utc = ZoneId.of("UTC")

    private fun session(
        id: Long,
        started: String,
        ended: String? = null,
        energyWh: Double? = null,
        cost: Double? = null,
        chargerType: String? = null,
        peakW: Double? = null,
        startSoc: Double? = null,
        endSoc: Double? = null,
        place: String? = null,
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
            endOdometerM = null,
            endSocPct = endSoc,
            endedAt = ended?.let { Instant.parse(it) },
            peakPowerW = peakW,
            startLat = null,
            startLng = null,
            startOdometerM = null,
            startPlace = place,
            startSocPct = startSoc,
            totalEnergyAddedWh = energyWh,
        )

    @Test
    fun chargerCategoryMapsRawTypes() {
        assertEquals(ChargerCat.Home, getChargerCategory(null))
        assertEquals(ChargerCat.Home, getChargerCategory("home wall"))
        assertEquals(ChargerCat.Supercharger, getChargerCategory("Supercharger V3"))
        assertEquals(ChargerCat.Supercharger, getChargerCategory("TPC"))
        assertEquals(ChargerCat.Dc, getChargerCategory("CCS combo"))
        assertEquals(ChargerCat.Unknown, getChargerCategory("mystery"))
    }

    @Test
    fun durationMinutesIsZeroForOpenSession() {
        assertEquals(0.0, durationMinutes(session(1, "2026-01-15T10:00:00Z")), 1e-9)
        assertEquals(60.0, durationMinutes(session(1, "2026-01-15T10:00:00Z", "2026-01-15T11:00:00Z")), 1e-9)
    }

    @Test
    fun periodStatsAggregatesEnergyCostAndRate() {
        val sessions =
            listOf(
                session(1, "2026-01-15T10:00:00Z", "2026-01-15T11:00:00Z", energyWh = 10_000.0, cost = 2.0, chargerType = "Supercharger"),
                session(2, "2026-01-16T10:00:00Z", "2026-01-16T11:00:00Z", energyWh = 5_000.0, cost = null, chargerType = null),
            )
        val stats = computeChargingPeriodStats(sessions, zone = utc)
        assertEquals(2, stats.count)
        assertEquals(15_000.0, stats.totalEnergyWh, 1e-6)
        assertEquals(2.0, stats.totalCost, 1e-6)
        assertEquals(1, stats.freeCount)
        assertEquals(1, stats.byCategory[ChargerCat.Supercharger])
        assertEquals(1, stats.byCategory[ChargerCat.Home])
        // 15 kWh over 2 hours total = 7.5 kW average rate.
        assertEquals(7.5, stats.avgRateKw!!, 1e-6)
    }

    @Test
    fun dateWindowFiltersOutOfRangeSessions() {
        val sessions =
            listOf(
                session(1, "2026-01-10T10:00:00Z", "2026-01-10T11:00:00Z", energyWh = 1_000.0),
                session(2, "2026-02-20T10:00:00Z", "2026-02-20T11:00:00Z", energyWh = 1_000.0),
            )
        val stats = computeChargingPeriodStats(sessions, startDate = "2026-01-01", endDate = "2026-01-31", zone = utc)
        assertEquals(1, stats.count)
    }

    @Test
    fun searchParsesKvAndTextTokens() {
        val tokens = parseSearchQuery("charger:home kwh:>5 \"san francisco\"")
        assertEquals(3, tokens.size)
        assertTrue(tokens[0] is SearchToken.Kv)
        assertEquals(CompareOp.Gt, (tokens[1] as SearchToken.Kv).op)
        assertEquals("san francisco", (tokens[2] as SearchToken.Text).value)
    }

    @Test
    fun matchesSessionTokensAppliesKvHandlers() {
        val s =
            session(
                1,
                "2026-01-15T10:00:00Z",
                "2026-01-15T11:00:00Z",
                energyWh = 20_000.0,
                cost = 3.0,
                chargerType = "Supercharger",
                place = "Costco",
            )
        assertTrue(matchesSessionTokens(s, parseSearchQuery("charger:sc"), utc))
        assertTrue(matchesSessionTokens(s, parseSearchQuery("kwh:>10"), utc))
        assertFalse(matchesSessionTokens(s, parseSearchQuery("kwh:>50"), utc))
        assertTrue(matchesSessionTokens(s, parseSearchQuery("costco"), utc))
        assertFalse(matchesSessionTokens(s, parseSearchQuery("free"), utc))
    }

    @Test
    fun durationTokenParsesShorthand() {
        assertEquals(90.0, parseDurationToken("1h30m")!!, 1e-9)
        assertEquals(2880.0, parseDurationToken("2d")!!, 1e-9)
        assertNull(parseDurationToken("later"))
    }

    @Test
    fun compareNumericHonorsOperators() {
        assertTrue(compareNumeric(6.0, CompareOp.Gt, 5.0))
        assertTrue(compareNumeric(5.0, CompareOp.Eq, 5.0))
        assertFalse(compareNumeric(4.0, CompareOp.Gte, 5.0))
    }

    @Test
    fun ymdPrefixMatches() {
        assertTrue(matchesYmdPrefix("2026-04-15", "2026"))
        assertTrue(matchesYmdPrefix("2026-04-15", "2026-04"))
        assertFalse(matchesYmdPrefix("2026-04-15", "2025"))
        assertFalse(matchesYmdPrefix(null, "2026"))
    }

    @Test
    fun sortAndPaginateOrderAndSlice() {
        val sessions =
            (1..120).map { i ->
                session(i.toLong(), "2026-01-${"%02d".format((i % 28) + 1)}T10:00:00Z", energyWh = i.toDouble())
            }
        val sortedDesc = sortSessions(sessions, ChargingSortField.Energy, desc = true)
        assertEquals(120.0, sortedDesc.first().totalEnergyAddedWh!!, 1e-9)
        val page2 = paginate(sortedDesc, page = 2, pageSize = 50)
        assertEquals(50, page2.size)
        assertEquals(70.0, page2.first().totalEnergyAddedWh!!, 1e-9)
    }

    @Test
    fun acDcBreakdownSplitsBySource() {
        val sessions =
            listOf(
                session(1, "2026-01-15T10:00:00Z", "2026-01-15T11:00:00Z", energyWh = 10_000.0, chargerType = "Supercharger"),
                session(2, "2026-01-16T10:00:00Z", "2026-01-16T11:00:00Z", energyWh = 5_000.0, chargerType = null, peakW = 5_000.0),
            )
        val breakdown = computeAcDcBreakdown(sessions)
        assertEquals(1, breakdown.dc.count)
        assertEquals(10_000.0, breakdown.dc.energy, 1e-6)
        assertEquals(1, breakdown.ac.count)
        assertEquals(15_000.0, breakdown.total.energy, 1e-6)
    }

    @Test
    fun startLevelDistributionBucketsBy10() {
        val sessions =
            listOf(
                session(1, "2026-01-15T10:00:00Z", startSoc = 5.0),
                session(2, "2026-01-15T11:00:00Z", startSoc = 15.0),
                session(3, "2026-01-15T12:00:00Z", startSoc = 95.0),
            )
        val dist = computeStartLevelDist(sessions)
        assertEquals(10, dist.size)
        assertEquals(1L, dist[0].count)
        assertEquals(1L, dist[1].count)
        assertEquals(1L, dist[9].count)
    }

    @Test
    fun efficiencyStatsNullWhenNoUsableSessions() {
        assertNull(computeEfficiencyStats(listOf(session(1, "2026-01-15T10:00:00Z"))))
        val stats = computeEfficiencyStats(listOf(session(1, "2026-01-15T10:00:00Z", "2026-01-15T11:00:00Z", energyWh = 6_000.0)))
        assertNotNull(stats)
        assertEquals(1, stats!!.count)
    }

    @Test
    fun anomalyDetectionFlagsTelemetryGap() {
        val anomalies = detectChargingAnomalies(listOf(session(1, "2026-01-15T10:00:00Z", "2026-01-15T10:30:00Z", energyWh = 0.0)))
        assertEquals(1, anomalies.size)
        assertEquals(ChargingAnomalyKind.TelemetryGap, anomalies.first().kind)
    }

    @Test
    fun dailyTrendBucketsSessionsByDay() {
        val sessions =
            listOf(
                session(1, "2026-01-15T10:00:00Z", "2026-01-15T11:00:00Z", energyWh = 1_000.0),
                session(2, "2026-01-15T14:00:00Z", "2026-01-15T15:00:00Z", energyWh = 1_000.0),
                session(3, "2026-01-16T10:00:00Z", "2026-01-16T11:00:00Z", energyWh = 1_000.0),
            )
        val trend = dailyChargingTrend(sessions, ChargingTrendMetric.Sessions, utc)
        assertEquals(2, trend.size)
        assertEquals(2.0, trend.first { it.date == "2026-01-15" }.value, 1e-9)
    }

    @Test
    fun numberFormattingHelpers() {
        assertEquals("1,234.5", fmtNumber(1234.45, 1))
        assertEquals("12.3K", fmtCompact(12_345.0))
        assertEquals("1h 30m", formatDurationMinutes(90.0))
        assertEquals("45m", formatDurationMinutes(45.0))
    }

    @Test
    fun priorPeriodIsSameLengthWindowBefore() {
        val prior = priorPeriod("2026-01-15", "2026-01-31")
        assertNotNull(prior)
        assertEquals("2026-01-14", prior!!.end)
        assertEquals("2025-12-29", prior.start)
    }

    @Test
    fun deriveProducesConsistentFilteredAndSelected() {
        val sessions =
            listOf(
                session(1, "2026-01-15T10:00:00Z", "2026-01-15T11:00:00Z", energyWh = 10_000.0, cost = 2.0, chargerType = "Supercharger"),
                session(2, "2026-01-16T10:00:00Z", "2026-01-16T11:00:00Z", energyWh = 5_000.0, cost = null, chargerType = null),
            )
        val interaction = ChargingListInteraction(collection = ChargingCollection.Supercharger, bulkSelected = setOf(1L, 2L))
        val derived = deriveChargingList(sessions, interaction, "2026-01-01", "2026-01-31", priorPeriod("2026-01-01", "2026-01-31"), utc)
        assertEquals(1, derived.filtered.size)
        assertEquals(1L, derived.filtered.first().id)
        // Only the visible (filtered) selected id survives the pruning.
        assertEquals(setOf(1L), derived.effectiveSelected)
        assertEquals(2, derived.counts.all)
        assertEquals(1, derived.counts.supercharger)
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeDiagnostic() {
        val logger = RecordingLogger()
        recordChargingListPageOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened", logger.events.first().first)
        assertEquals("ChargingListPage", logger.events.first().second["surface"])
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
}
