package io.teslasync.android.dashboard.widgets.solarproduction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/**
 * Off-device verification of the SolarProductionWidget's pure logic — the chart/stat projection
 * (Today by date-key match, 30-Day Total sum, Daily Avg mean, the compact vs standard stat selection),
 * the two-feed parsing (energy-sites first-id + length gate; energy-history Wh → kWh + M/d labels +
 * today-match), the empty gates (no site vs no/zero data), the registry metadata + window helpers, and
 * the date formatter. Mirrors the web spec
 * (web/src/features/dashboard/widgets/SolarProductionWidget.tsx).
 */
class SolarProductionProjectionTest {
    private val strings =
        SolarProductionStrings(
            title = "Solar Production",
            noSite = "No Tesla Energy site linked",
            noData = "No solar data",
            today = "Today",
            avg = "Daily Avg",
            total30d = "30-Day Total",
            solar = "Solar",
        )

    private fun day(
        dateKey: String,
        kwh: Double,
        label: String = dateKey,
    ): SolarDayPoint = SolarDayPoint(dateKey = dateKey, label = label, solarKwh = kwh)

    private fun project(
        days: List<SolarDayPoint>,
        todayKwh: Double = 0.0,
        size: SolarProductionSize = SolarProductionRegistration.defaultSize,
    ): SolarProductionDisplay = SolarProductionProjection.project(SolarProductionSnapshot.ofDays(days, todayKwh), size, strings)

    private fun statValue(
        display: SolarProductionDisplay,
        label: String,
    ): SolarProductionStat = display.stats.single { it.label == label }

    private val twoDays =
        listOf(
            day("2024-06-10", 2.0, label = "6/10"),
            day("2024-06-11", 4.0, label = "6/11"),
        )

    // ---- stats: standard vs compact -------------------------------------------------

    @Test
    fun standardSizeShowsTodayTotalAvgInKwh() {
        val display = project(twoDays, todayKwh = 4.0)
        assertEquals(3, display.stats.size)
        // Order matches the web standard stat array: Today, 30-Day Total, Daily Avg.
        assertEquals(listOf("Today", "30-Day Total", "Daily Avg"), display.stats.map { it.label })

        assertEquals("4.0", statValue(display, "Today").value)
        assertEquals("6", statValue(display, "30-Day Total").value)
        assertEquals("3.0", statValue(display, "Daily Avg").value)
        display.stats.forEach { assertEquals("kWh", it.unit) }
    }

    @Test
    fun compactSizeShowsOnlyTodayAndDailyAvg() {
        val display = project(twoDays, todayKwh = 4.0, size = SolarProductionSize(cols = 1, rows = 4))
        assertEquals(2, display.stats.size)
        assertEquals(listOf("Today", "Daily Avg"), display.stats.map { it.label })
    }

    @Test
    fun noDataYieldsEmptyStats() {
        assertTrue(project(emptyList()).stats.isEmpty())
        // A linked site whose only rows are all-zero is "no data" too (web hasData .some(> 0)).
        assertTrue(project(listOf(day("2024-06-11", 0.0))).stats.isEmpty())
    }

    // ---- rollups --------------------------------------------------------------------

    @Test
    fun totalIsSumOfDailyKwh() {
        assertEquals(6.0, SolarProductionProjection.totalKwh(twoDays), 0.0)
        assertEquals(0.0, SolarProductionProjection.totalKwh(emptyList()), 0.0)
    }

    @Test
    fun avgIsMeanAndZeroWhenEmpty() {
        assertEquals(3.0, SolarProductionProjection.avgKwh(twoDays), 0.0)
        assertEquals(0.0, SolarProductionProjection.avgKwh(emptyList()), 0.0)
    }

    @Test
    fun todayKwhMatchesByDateKeyElseZero() {
        assertEquals(4.0, todayKwh(twoDays, "2024-06-11"), 0.0)
        assertEquals(2.0, todayKwh(twoDays, "2024-06-10"), 0.0)
        assertEquals(0.0, todayKwh(twoDays, "2024-01-01"), 0.0)
        assertEquals(0.0, todayKwh(emptyList(), "2024-06-11"), 0.0)
    }

    // ---- hasData gate ---------------------------------------------------------------

    @Test
    fun hasDataFalseWhenEmptyOrAllZero() {
        assertFalse(SolarProductionSnapshot.ofDays(emptyList(), 0.0).hasData)
        assertFalse(SolarProductionSnapshot.ofDays(listOf(day("2024-06-10", 0.0), day("2024-06-11", 0.0)), 0.0).hasData)
    }

    @Test
    fun hasDataTrueWhenAnyDayPositive() {
        assertTrue(SolarProductionSnapshot.ofDays(listOf(day("2024-06-10", 0.0), day("2024-06-11", 1.5)), 0.0).hasData)
    }

    // ---- footprint flags (web size.cols <= 1 / >= 3) --------------------------------

    @Test
    fun footprintFlagsMatchWeb() {
        assertTrue(SolarProductionSize(cols = 1, rows = 4).isCompact)
        assertFalse(SolarProductionSize(cols = 2, rows = 4).isCompact)
        assertFalse(SolarProductionSize(cols = 2, rows = 4).isWide)
        assertTrue(SolarProductionSize(cols = 3, rows = 4).isWide)
    }

    @Test
    fun noSiteDisplayCarriesMessageAndNoStats() {
        val display = SolarProductionProjection.project(SolarProductionSnapshot.NO_SITES, SolarProductionRegistration.defaultSize, strings)
        assertFalse(display.hasSites)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertEquals("No Tesla Energy site linked", display.noSiteMessage)
        assertEquals("No solar data", display.noDataMessage)
    }

    // ---- parsing: energy sites ------------------------------------------------------

    @Test
    fun parseSitesReadsFirstSiteId() {
        val summary = parseSolarSites(sitesJson(siteId = 12345L))
        assertTrue(summary.hasSites)
        assertEquals(12345L, summary.firstSiteId)
    }

    @Test
    fun parseSitesEmptyArrayHasNoSite() {
        val summary = parseSolarSites(emptySitesJson())
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseSitesFirstRowWithoutIdStillHasSites() {
        val summary = parseSolarSites(sitesJson(siteId = null))
        assertTrue(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseSitesNonArrayHasNoSite() {
        val summary = parseSolarSites(emptyObjectJson())
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    // ---- parsing: energy history ----------------------------------------------------

    @Test
    fun parseDaysScalesWattHoursToKwh() {
        val rows = historyJson(listOf(SolarRow(timestamp = "2024-06-11T00:00:00Z", solarWh = 2500.0)))
        val days = parseSolarDays(rows, ZoneId.of("UTC"))
        assertEquals(1, days.size)
        val first = days.first()
        assertEquals(2.5, first.solarKwh, 0.0)
        assertEquals("2024-06-11", first.dateKey)
        assertEquals("6/11", first.label)
    }

    @Test
    fun parseDaysMissingSolarCollapsesToZero() {
        val days = parseSolarDays(historyJson(listOf(SolarRow(timestamp = "2024-06-11T00:00:00Z"))), ZoneId.of("UTC"))
        assertEquals(0.0, days.first().solarKwh, 0.0)
        assertEquals("2024-06-11", days.first().dateKey)
    }

    @Test
    fun parseDaysNonArrayYieldsEmpty() {
        assertTrue(parseSolarDays(emptyObjectJson()).isEmpty())
        assertTrue(parseSolarDays(null).isEmpty())
        assertTrue(parseSolarDays(emptyHistoryJson()).isEmpty())
    }

    @Test
    fun solarSnapshotResolvesTodayKwh() {
        val rows =
            historyJson(
                listOf(
                    SolarRow(timestamp = "2024-06-10T00:00:00Z", solarWh = 2000.0),
                    SolarRow(timestamp = "2024-06-11T00:00:00Z", solarWh = 4000.0),
                ),
            )
        val snapshot = solarSnapshotOf(rows, todayKey = "2024-06-11", zone = ZoneId.of("UTC"))
        assertTrue(snapshot.hasSites)
        assertTrue(snapshot.hasData)
        assertEquals(4.0, snapshot.todayKwh, 0.0)
    }

    // ---- date formatter -------------------------------------------------------------

    @Test
    fun shortDateFormatsMonthDayInZone() {
        assertEquals("6/11", shortDate("2024-06-11T08:30:00Z", ZoneId.of("UTC")))
        // 02:00Z on the 11th is 19:00 on the 10th in PDT (UTC-7) → the local date rolls back.
        assertEquals("6/10", shortDate("2024-06-11T02:00:00Z", ZoneId.of("America/Los_Angeles")))
    }

    @Test
    fun shortDateAcceptsDateOnlyAndRawFallback() {
        assertEquals("6/9", shortDate("2024-06-09", ZoneId.of("UTC")))
        assertEquals("not-a-date", shortDate("not-a-date", ZoneId.of("UTC")))
        assertEquals("", shortDate("", ZoneId.of("UTC")))
    }

    // ---- registry metadata (web registry/energy.ts) --------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("solar-production", SolarProductionRegistration.ID)
        assertEquals("energy", SolarProductionRegistration.CATEGORY)
        assertEquals("SolarProductionWidget", SolarProductionRegistration.SLUG)
        assertEquals(SolarProductionSize(cols = 2, rows = 4), SolarProductionRegistration.defaultSize)
        assertEquals(SolarProductionSize(cols = 1, rows = 2), SolarProductionRegistration.minSize)
        assertEquals(SolarProductionSize(cols = 4, rows = 40), SolarProductionRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(SolarProductionRegistration.isWithinBounds(SolarProductionSize(cols = 2, rows = 4)))
        assertTrue(SolarProductionRegistration.isWithinBounds(SolarProductionSize(cols = 1, rows = 2)))
        assertFalse(SolarProductionRegistration.isWithinBounds(SolarProductionSize(cols = 1, rows = 1)))
        assertFalse(SolarProductionRegistration.isWithinBounds(SolarProductionSize(cols = 5, rows = 50)))
        assertEquals(
            SolarProductionSize(cols = 1, rows = 2),
            SolarProductionRegistration.clamp(SolarProductionSize(cols = 0, rows = 0)),
        )
        assertEquals(
            SolarProductionSize(cols = 4, rows = 40),
            SolarProductionRegistration.clamp(SolarProductionSize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun windowHelpersResolveUtcDates() {
        val now = Instant.parse("2024-06-11T12:00:00Z").toEpochMilli()
        assertEquals("2024-06-11", SolarProductionRegistration.todayKey(now))
        assertEquals("2024-05-12", SolarProductionRegistration.windowStartDate(now))
    }

    @Test
    fun todayKeyUsesUtcReferenceFrame() {
        // 06:30Z is past midnight UTC → the web toISOString() key is the UTC date regardless of device zone.
        val now = Instant.parse("2024-06-12T06:30:00Z").toEpochMilli()
        assertEquals("2024-06-12", SolarProductionRegistration.todayKey(now))
    }
}
