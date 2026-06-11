package io.teslasync.android.dashboard.widgets.powerflowhistory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/**
 * Off-device verification of the PowerFlowHistoryWidget's pure logic — the chart/stat projection
 * (Avg Solar mean, Peak Home floored max, Net Grid signed sum, the compact vs standard stat selection),
 * the two-feed parsing (energy-sites first-id + length gate; live-status-history watts → kW + HH:mm
 * labels), the empty gates (no site vs no/zero data), the registry metadata + window-start helper, and
 * the time formatter. Mirrors the web spec
 * (web/src/features/dashboard/widgets/PowerFlowHistoryWidget.tsx).
 */
class PowerFlowHistoryProjectionTest {
    private val strings =
        PowerFlowHistoryStrings(
            title = "Power Flow History",
            noSite = "No Tesla Energy site linked",
            noData = "No power flow data",
            avgSolar = "Avg Solar",
            peakHome = "Peak Home",
            netGrid = "Net Grid",
            solar = "Solar",
            battery = "Battery",
            grid = "Grid",
            home = "Home",
        )

    private fun sample(
        solar: Double = 0.0,
        battery: Double = 0.0,
        grid: Double = 0.0,
        home: Double = 0.0,
        label: String = "00:00",
    ): PowerFlowSample = PowerFlowSample(timeLabel = label, solarKw = solar, batteryKw = battery, gridKw = grid, homeKw = home)

    private fun project(
        samples: List<PowerFlowSample>,
        size: PowerFlowHistorySize = PowerFlowHistoryRegistration.defaultSize,
    ): PowerFlowHistoryDisplay = PowerFlowHistoryProjection.project(PowerFlowHistorySnapshot.ofSamples(samples), size, strings)

    private fun statValue(
        display: PowerFlowHistoryDisplay,
        label: String,
    ): PowerFlowHistoryStat = display.stats.single { it.label == label }

    private val twoRows =
        listOf(
            sample(solar = 2.0, home = 1.0, grid = 0.5, label = "08:00"),
            sample(solar = 4.0, home = 3.0, grid = -1.5, label = "09:00"),
        )

    // ---- stats: standard vs compact -------------------------------------------------

    @Test
    fun standardSizeShowsAvgPeakNetInKw() {
        val display = project(twoRows)
        assertEquals(3, display.stats.size)

        val avg = statValue(display, "Avg Solar")
        assertEquals("3.0", avg.value)
        assertEquals(PowerFlowHistoryProjection.KW_UNIT, avg.unit)

        assertEquals("3.0", statValue(display, "Peak Home").value)
        assertEquals("-1.0", statValue(display, "Net Grid").value)
        display.stats.forEach { assertEquals("kW", it.unit) }
    }

    @Test
    fun compactSizeShowsOnlyAvgSolarAndPeakHome() {
        val display = project(twoRows, PowerFlowHistorySize(cols = 1, rows = 4))
        assertEquals(2, display.stats.size)
        assertEquals(listOf("Avg Solar", "Peak Home"), display.stats.map { it.label })
    }

    @Test
    fun noDataYieldsEmptyStats() {
        assertTrue(project(emptyList()).stats.isEmpty())
        // A linked site whose only rows are all-zero is "no data" too (web hasData .some(!== 0)).
        assertTrue(project(listOf(sample())).stats.isEmpty())
    }

    // ---- rollups --------------------------------------------------------------------

    @Test
    fun avgSolarIsMeanAndZeroWhenEmpty() {
        assertEquals(3.0, PowerFlowHistoryProjection.avgSolarKw(twoRows), 0.0)
        assertEquals(0.0, PowerFlowHistoryProjection.avgSolarKw(emptyList()), 0.0)
    }

    @Test
    fun peakHomeIsMaxFlooredAtZero() {
        assertEquals(3.0, PowerFlowHistoryProjection.peakHomeKw(twoRows), 0.0)
        // All-negative home still floors at 0 (web reduce seed 0).
        assertEquals(0.0, PowerFlowHistoryProjection.peakHomeKw(listOf(sample(home = -2.0))), 0.0)
    }

    @Test
    fun netGridIsSignedSum() {
        assertEquals(-1.0, PowerFlowHistoryProjection.netGridKw(twoRows), 0.0)
    }

    // ---- hasData gate ---------------------------------------------------------------

    @Test
    fun hasDataFalseWhenEmptyOrAllZero() {
        assertFalse(PowerFlowHistorySnapshot.ofSamples(emptyList()).hasData)
        assertFalse(PowerFlowHistorySnapshot.ofSamples(listOf(sample(), sample())).hasData)
    }

    @Test
    fun hasDataTrueWhenAnyChannelNonZero() {
        assertTrue(PowerFlowHistorySnapshot.ofSamples(listOf(sample(), sample(grid = -0.2))).hasData)
    }

    // ---- footprint flags (web size.cols <= 1 / >= 3) --------------------------------

    @Test
    fun footprintFlagsMatchWeb() {
        assertTrue(PowerFlowHistorySize(cols = 1, rows = 4).isCompact)
        assertFalse(PowerFlowHistorySize(cols = 2, rows = 4).isCompact)
        assertFalse(PowerFlowHistorySize(cols = 2, rows = 4).isWide)
        assertTrue(PowerFlowHistorySize(cols = 3, rows = 4).isWide)
    }

    @Test
    fun noSiteDisplayCarriesMessageAndNoStats() {
        val display =
            PowerFlowHistoryProjection.project(PowerFlowHistorySnapshot.NO_SITES, PowerFlowHistoryRegistration.defaultSize, strings)
        assertFalse(display.hasSites)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertEquals("No Tesla Energy site linked", display.noSiteMessage)
        assertEquals("No power flow data", display.noDataMessage)
    }

    // ---- parsing: energy sites ------------------------------------------------------

    @Test
    fun parseSitesReadsFirstSiteId() {
        val summary = parsePowerFlowSites(sitesJson(siteId = 12345L))
        assertTrue(summary.hasSites)
        assertEquals(12345L, summary.firstSiteId)
    }

    @Test
    fun parseSitesEmptyArrayHasNoSite() {
        val summary = parsePowerFlowSites(emptySitesJson())
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseSitesFirstRowWithoutIdStillHasSites() {
        val summary = parsePowerFlowSites(sitesJson(siteId = null))
        assertTrue(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseSitesNonArrayHasNoSite() {
        val summary = parsePowerFlowSites(emptyObjectJson())
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    // ---- parsing: live-status history ----------------------------------------------

    @Test
    fun parseSamplesScalesWattsToKw() {
        val rows =
            historyJson(
                listOf(
                    HistoryRow(timestamp = "2024-06-11T08:30:00Z", solar = 2500.0, battery = -800.0, grid = -1500.0, load = 1000.0),
                ),
            )
        val samples = parsePowerFlowSamples(rows, ZoneId.of("UTC"))
        assertEquals(1, samples.size)
        val first = samples.first()
        assertEquals(2.5, first.solarKw, 0.0)
        assertEquals(-0.8, first.batteryKw, 0.0)
        assertEquals(-1.5, first.gridKw, 0.0)
        assertEquals(1.0, first.homeKw, 0.0)
        assertEquals("08:30", first.timeLabel)
    }

    @Test
    fun parseSamplesMissingFieldsCollapseToZero() {
        val samples =
            parsePowerFlowSamples(historyJson(listOf(HistoryRow(timestamp = "2024-06-11T00:00:00Z", solar = 1000.0))), ZoneId.of("UTC"))
        val first = samples.first()
        assertEquals(1.0, first.solarKw, 0.0)
        assertEquals(0.0, first.batteryKw, 0.0)
        assertEquals(0.0, first.gridKw, 0.0)
        assertEquals(0.0, first.homeKw, 0.0)
    }

    @Test
    fun parseSamplesNonArrayYieldsEmpty() {
        assertTrue(parsePowerFlowSamples(emptyObjectJson()).isEmpty())
        assertTrue(parsePowerFlowSamples(null).isEmpty())
        assertTrue(parsePowerFlowSamples(emptyHistoryJson()).isEmpty())
    }

    // ---- time formatter -------------------------------------------------------------

    @Test
    fun shortTimeFormatsHourMinuteInZone() {
        assertEquals("08:30", shortTime("2024-06-11T08:30:00Z", ZoneId.of("UTC")))
        // The same instant renders in the supplied zone (PDT = UTC-7).
        assertEquals("01:30", shortTime("2024-06-11T08:30:00Z", ZoneId.of("America/Los_Angeles")))
    }

    @Test
    fun shortTimeInvalidReturnsRawInput() {
        assertEquals("not-a-date", shortTime("not-a-date", ZoneId.of("UTC")))
        assertEquals("", shortTime("", ZoneId.of("UTC")))
    }

    // ---- registry metadata (web registry/energy.ts) --------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("power-flow-history", PowerFlowHistoryRegistration.ID)
        assertEquals("energy", PowerFlowHistoryRegistration.CATEGORY)
        assertEquals("PowerFlowHistoryWidget", PowerFlowHistoryRegistration.SLUG)
        assertEquals(PowerFlowHistorySize(cols = 2, rows = 4), PowerFlowHistoryRegistration.defaultSize)
        assertEquals(PowerFlowHistorySize(cols = 2, rows = 4), PowerFlowHistoryRegistration.minSize)
        assertEquals(PowerFlowHistorySize(cols = 4, rows = 40), PowerFlowHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(PowerFlowHistoryRegistration.isWithinBounds(PowerFlowHistorySize(cols = 2, rows = 4)))
        assertFalse(PowerFlowHistoryRegistration.isWithinBounds(PowerFlowHistorySize(cols = 1, rows = 4)))
        assertFalse(PowerFlowHistoryRegistration.isWithinBounds(PowerFlowHistorySize(cols = 5, rows = 50)))
        assertEquals(
            PowerFlowHistorySize(cols = 2, rows = 4),
            PowerFlowHistoryRegistration.clamp(PowerFlowHistorySize(cols = 1, rows = 1)),
        )
        assertEquals(
            PowerFlowHistorySize(cols = 4, rows = 40),
            PowerFlowHistoryRegistration.clamp(PowerFlowHistorySize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun windowStartIsExactly24HoursBeforeNow() {
        val now = Instant.parse("2024-06-11T12:00:00Z").toEpochMilli()
        assertEquals("2024-06-10T12:00:00Z", PowerFlowHistoryRegistration.windowStartIso(now))
    }
}
