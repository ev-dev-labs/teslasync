package io.teslasync.android.dashboard.widgets.wallconnector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId

/**
 * Off-device verification of the WallConnectorWidget's pure logic — the chart/stat projection (This
 * Month total, Sessions count, Avg / Session, the compact vs standard stat selection), the per-day
 * aggregation (sum-by-day, ascending, blank-key skip), the current-month rollups (isSameMonth filter),
 * the two-feed parsing (energy-sites first-id + length gate; charging-history Wh → kWh + M/d labels), the
 * empty gates (no site vs no/zero data), the registry metadata + window helpers, and the date formatter.
 * Mirrors the web spec (web/src/features/dashboard/widgets/WallConnectorWidget.tsx).
 */
class WallConnectorProjectionTest {
    private val strings =
        WallConnectorStrings(
            title = "Wall Connector",
            noSite = "No Tesla Energy site linked",
            noData = "No Wall Connector data",
            monthTotal = "This Month",
            sessions = "Sessions",
            avgPerSession = "Avg / Session",
            energy = "Energy",
        )

    private fun day(
        dateKey: String,
        kwh: Double,
        label: String = dateKey,
    ): WallConnectorDayPoint = WallConnectorDayPoint(dateKey = dateKey, label = label, energyKwh = kwh)

    private fun project(
        snapshot: WallConnectorSnapshot,
        size: WallConnectorSize = WallConnectorRegistration.defaultSize,
    ): WallConnectorDisplay = WallConnectorProjection.project(snapshot, size, strings)

    private fun statValue(
        display: WallConnectorDisplay,
        label: String,
    ): WallConnectorStat = display.stats.single { it.label == label }

    private val twoDays =
        listOf(
            day("2024-06-10", 2.0, label = "6/10"),
            day("2024-06-11", 4.0, label = "6/11"),
        )

    private fun snapshot(
        days: List<WallConnectorDayPoint> = twoDays,
        monthTotalKwh: Double = 12.5,
        monthSessions: Int = 3,
        avgKwhPerSession: Double = 4.0,
    ): WallConnectorSnapshot = WallConnectorSnapshot.ofData(days, monthTotalKwh, monthSessions, avgKwhPerSession)

    // ---- stats: standard vs compact -------------------------------------------------

    @Test
    fun standardSizeShowsMonthSessionsAndAvgInKwh() {
        val display = project(snapshot(monthTotalKwh = 12.5, monthSessions = 3, avgKwhPerSession = 4.0))
        assertEquals(3, display.stats.size)
        // Order matches the web standard stat array: This Month, Sessions, Avg / Session.
        assertEquals(listOf("This Month", "Sessions", "Avg / Session"), display.stats.map { it.label })

        assertEquals("12.5", statValue(display, "This Month").value)
        assertEquals("3", statValue(display, "Sessions").value)
        assertEquals("4.0", statValue(display, "Avg / Session").value)
    }

    @Test
    fun monthTotalAndAvgCarryKwhWhileSessionsHasNoUnit() {
        val display = project(snapshot())
        assertEquals("kWh", statValue(display, "This Month").unit)
        assertEquals("kWh", statValue(display, "Avg / Session").unit)
        // Web omits the unit on the Sessions tile (no `unit:` key).
        assertNull(statValue(display, "Sessions").unit)
    }

    @Test
    fun compactSizeShowsOnlyMonthAndSessions() {
        val display = project(snapshot(), size = WallConnectorSize(cols = 1, rows = 4))
        assertEquals(2, display.stats.size)
        assertEquals(listOf("This Month", "Sessions"), display.stats.map { it.label })
    }

    @Test
    fun noDataYieldsEmptyStats() {
        assertTrue(project(snapshot(days = emptyList())).stats.isEmpty())
        // A linked site whose only chart rows are all-zero is "no data" too (web hasData .some(> 0)).
        assertTrue(project(snapshot(days = listOf(day("2024-06-11", 0.0)))).stats.isEmpty())
    }

    @Test
    fun sessionCountFormatsWithGroupingAndNoDecimals() {
        val display = project(snapshot(monthSessions = 1234))
        assertEquals("1,234", statValue(display, "Sessions").value)
    }

    // ---- hasData gate ---------------------------------------------------------------

    @Test
    fun hasDataFalseWhenEmptyOrAllZero() {
        assertFalse(snapshot(days = emptyList()).hasData)
        assertFalse(snapshot(days = listOf(day("2024-06-10", 0.0), day("2024-06-11", 0.0))).hasData)
    }

    @Test
    fun hasDataTrueWhenAnyDayPositive() {
        assertTrue(snapshot(days = listOf(day("2024-06-10", 0.0), day("2024-06-11", 1.5))).hasData)
    }

    // ---- footprint flags (web size.cols <= 1 / >= 3) --------------------------------

    @Test
    fun footprintFlagsMatchWeb() {
        assertTrue(WallConnectorSize(cols = 1, rows = 4).isCompact)
        assertFalse(WallConnectorSize(cols = 2, rows = 4).isCompact)
        assertFalse(WallConnectorSize(cols = 2, rows = 4).isWide)
        assertTrue(WallConnectorSize(cols = 3, rows = 4).isWide)
    }

    @Test
    fun noSiteDisplayCarriesMessageAndNoStats() {
        val display = WallConnectorProjection.project(WallConnectorSnapshot.NO_SITES, WallConnectorRegistration.defaultSize, strings)
        assertFalse(display.hasSites)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertEquals("No Tesla Energy site linked", display.noSiteMessage)
        assertEquals("No Wall Connector data", display.noDataMessage)
        assertEquals("Energy", display.energyLabel)
    }

    // ---- parsing: energy sites ------------------------------------------------------

    @Test
    fun parseSitesReadsFirstSiteId() {
        val summary = parseWallConnectorSites(sitesJson(siteId = 12345L))
        assertTrue(summary.hasSites)
        assertEquals(12345L, summary.firstSiteId)
    }

    @Test
    fun parseSitesEmptyArrayHasNoSite() {
        val summary = parseWallConnectorSites(emptySitesJson())
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseSitesFirstRowWithoutIdStillHasSites() {
        val summary = parseWallConnectorSites(sitesJson(siteId = null))
        assertTrue(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseSitesNonArrayHasNoSite() {
        val summary = parseWallConnectorSites(emptyObjectJson())
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    // ---- parsing + aggregation: charging history ------------------------------------

    @Test
    fun parseEntriesScalesWattHoursToKwh() {
        val entries = parseWallConnectorEntries(historyJson(listOf(WcRow(timestamp = "2024-06-11T00:00:00Z", energyWh = 2500.0))), UTC)
        assertEquals(1, entries.size)
        assertEquals(2.5, entries.first().energyKwh, 0.0)
        assertEquals("2024-06-11", entries.first().dayKey)
        assertEquals(YearMonth.of(2024, 6), entries.first().yearMonth)
    }

    @Test
    fun parseEntriesMissingEnergyCollapsesToZero() {
        val entries = parseWallConnectorEntries(historyJson(listOf(WcRow(timestamp = "2024-06-11T00:00:00Z"))), UTC)
        assertEquals(0.0, entries.first().energyKwh, 0.0)
    }

    @Test
    fun parseEntriesNonArrayYieldsEmpty() {
        assertTrue(parseWallConnectorEntries(emptyObjectJson()).isEmpty())
        assertTrue(parseWallConnectorEntries(null).isEmpty())
        assertTrue(parseWallConnectorEntries(emptyHistoryJson()).isEmpty())
    }

    @Test
    fun aggregateSumsEnergyByDayAscending() {
        val entries =
            parseWallConnectorEntries(
                historyJson(
                    listOf(
                        WcRow(timestamp = "2024-06-11T08:00:00Z", energyWh = 4000.0),
                        WcRow(timestamp = "2024-06-11T20:00:00Z", energyWh = 1000.0),
                        WcRow(timestamp = "2024-06-10T09:00:00Z", energyWh = 2000.0),
                    ),
                ),
                UTC,
            )
        val days = aggregateDailyKwh(entries, UTC)
        // Two same-day sessions sum into one bucket; days are sorted ascending by raw date key.
        assertEquals(listOf("2024-06-10", "2024-06-11"), days.map { it.dateKey })
        assertEquals(2.0, days[0].energyKwh, 0.0)
        assertEquals(5.0, days[1].energyKwh, 0.0)
        assertEquals(listOf("6/10", "6/11"), days.map { it.label })
    }

    @Test
    fun aggregateSkipsBlankDayKeyEntries() {
        val entries =
            parseWallConnectorEntries(
                historyJson(
                    listOf(
                        WcRow(timestamp = null, energyWh = 9000.0),
                        WcRow(timestamp = "2024-06-11T08:00:00Z", energyWh = 2000.0),
                    ),
                ),
                UTC,
            )
        val days = aggregateDailyKwh(entries, UTC)
        // Web `if (!day) continue` — the timestamp-less session never reaches the chart.
        assertEquals(1, days.size)
        assertEquals("2024-06-11", days.first().dateKey)
        assertEquals(2.0, days.first().energyKwh, 0.0)
    }

    // ---- snapshot: month rollups (web isSameMonth) ----------------------------------

    @Test
    fun snapshotComputesCurrentMonthRollups() {
        val json =
            historyJson(
                listOf(
                    WcRow(timestamp = "2024-06-10T12:00:00Z", energyWh = 2000.0),
                    WcRow(timestamp = "2024-06-11T12:00:00Z", energyWh = 4000.0),
                    WcRow(timestamp = "2024-06-11T18:00:00Z", energyWh = 1000.0),
                    // A prior-month session: counted in the chart, excluded from "This Month".
                    WcRow(timestamp = "2024-05-20T12:00:00Z", energyWh = 3000.0),
                ),
            )
        val snapshot = wallConnectorSnapshotOf(json, nowYearMonth = YearMonth.of(2024, 6), zone = UTC)
        assertTrue(snapshot.hasSites)
        assertTrue(snapshot.hasData)
        // Chart spans every window day (incl. May), sorted ascending.
        assertEquals(listOf("2024-05-20", "2024-06-10", "2024-06-11"), snapshot.days.map { it.dateKey })
        // This Month = three June sessions only.
        assertEquals(3, snapshot.monthSessions)
        assertEquals(7.0, snapshot.monthTotalKwh, 1e-9)
        assertEquals(7.0 / 3.0, snapshot.avgKwhPerSession, 1e-9)
    }

    @Test
    fun snapshotAvgIsZeroWhenNoSessionsThisMonth() {
        val json = historyJson(listOf(WcRow(timestamp = "2024-05-20T12:00:00Z", energyWh = 3000.0)))
        val snapshot = wallConnectorSnapshotOf(json, nowYearMonth = YearMonth.of(2024, 6), zone = UTC)
        assertEquals(0, snapshot.monthSessions)
        assertEquals(0.0, snapshot.monthTotalKwh, 0.0)
        assertEquals(0.0, snapshot.avgKwhPerSession, 0.0)
        // The May session still renders in the chart.
        assertTrue(snapshot.hasData)
    }

    @Test
    fun snapshotEmptyHistoryHasSitesButNoData() {
        val snapshot = wallConnectorSnapshotOf(emptyHistoryJson(), nowYearMonth = YearMonth.of(2024, 6), zone = UTC)
        assertTrue(snapshot.hasSites)
        assertFalse(snapshot.hasData)
        assertTrue(snapshot.days.isEmpty())
    }

    // ---- date formatter -------------------------------------------------------------

    @Test
    fun shortDateFormatsMonthDayInZone() {
        assertEquals("6/11", shortDate("2024-06-11T08:30:00Z", UTC))
        // 02:00Z on the 11th is 19:00 on the 10th in PDT (UTC-7) → the local date rolls back.
        assertEquals("6/10", shortDate("2024-06-11T02:00:00Z", ZoneId.of("America/Los_Angeles")))
    }

    @Test
    fun shortDateAcceptsDateOnlyAndRawFallback() {
        assertEquals("6/9", shortDate("2024-06-09", UTC))
        assertEquals("not-a-date", shortDate("not-a-date", UTC))
        assertEquals("", shortDate("", UTC))
    }

    // ---- registry metadata (web registry/charging.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("wall-connector", WallConnectorRegistration.ID)
        assertEquals("charging", WallConnectorRegistration.CATEGORY)
        assertEquals("WallConnectorWidget", WallConnectorRegistration.SLUG)
        assertEquals(
            "Home charging stats from Tesla Wall Connector: daily kWh, session history",
            WallConnectorRegistration.DESCRIPTION,
        )
        assertEquals(WallConnectorSize(cols = 2, rows = 4), WallConnectorRegistration.defaultSize)
        assertEquals(WallConnectorSize(cols = 1, rows = 2), WallConnectorRegistration.minSize)
        assertEquals(WallConnectorSize(cols = 4, rows = 40), WallConnectorRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(WallConnectorRegistration.isWithinBounds(WallConnectorSize(cols = 2, rows = 4)))
        assertTrue(WallConnectorRegistration.isWithinBounds(WallConnectorSize(cols = 1, rows = 2)))
        assertFalse(WallConnectorRegistration.isWithinBounds(WallConnectorSize(cols = 1, rows = 1)))
        assertFalse(WallConnectorRegistration.isWithinBounds(WallConnectorSize(cols = 5, rows = 50)))
        assertEquals(
            WallConnectorSize(cols = 1, rows = 2),
            WallConnectorRegistration.clamp(WallConnectorSize(cols = 0, rows = 0)),
        )
        assertEquals(
            WallConnectorSize(cols = 4, rows = 40),
            WallConnectorRegistration.clamp(WallConnectorSize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun windowStartDateIsFourteenDaysBeforeUtcToday() {
        val now = Instant.parse("2024-06-11T12:00:00Z").toEpochMilli()
        assertEquals("2024-05-28", WallConnectorRegistration.windowStartDate(now))
    }

    @Test
    fun currentYearMonthUsesZoneLocalDate() {
        val noon = Instant.parse("2024-06-11T12:00:00Z").toEpochMilli()
        assertEquals(YearMonth.of(2024, 6), WallConnectorRegistration.currentYearMonth(noon, UTC))
        // 01:00Z on Jul 1 is 18:00 on Jun 30 in PDT (UTC-7) → still June locally.
        val boundary = Instant.parse("2024-07-01T01:00:00Z").toEpochMilli()
        assertEquals(YearMonth.of(2024, 6), WallConnectorRegistration.currentYearMonth(boundary, ZoneId.of("America/Los_Angeles")))
    }

    private companion object {
        val UTC: ZoneId = ZoneId.of("UTC")
    }
}
