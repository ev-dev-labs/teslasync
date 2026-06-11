package io.teslasync.android.dashboard.widgets.livepowerflow

import io.teslasync.android.components.datadisplay.FreshnessAge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LivePowerFlowWidget's pure logic — the nodes/arrows projection
 * (Solar/Grid/Home/Battery readouts, the six directional flows + their sign/activation tests, per-node
 * a11y), the two-feed parsing (energy-sites first-id + length gate, live-status watts → kW), the empty
 * gates (no site vs no live data), the registry metadata, and the kW/number formatters. Mirrors the web
 * spec (web/src/features/dashboard/widgets/LivePowerFlowWidget.tsx).
 */
class LivePowerFlowProjectionTest {
    private fun strings(): LivePowerFlowStrings =
        LivePowerFlowStrings(
            title = "Live Power Flow",
            noSite = "No Tesla Energy site linked",
            noData = "No live power data",
            solar = "Solar",
            grid = "Grid",
            home = "Home",
            battery = "Battery",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = ::renderRelative,
        )

    private fun project(
        status: LivePowerStatus?,
        hasSites: Boolean = status != null,
        size: LivePowerFlowSize = LivePowerFlowRegistration.defaultSize,
    ): LivePowerFlowDisplay = LivePowerFlowProjection.project(LivePowerFlowSnapshot(hasSites, status), size, strings())

    private fun nodeById(
        display: LivePowerFlowDisplay,
        id: String,
    ): PowerFlowNode = display.nodes.single { it.id == id }

    private fun arrow(
        display: LivePowerFlowDisplay,
        from: String,
        to: String,
    ): PowerFlowArrow? = display.arrows.firstOrNull { it.fromId == from && it.toId == to }

    // ---- nodes: four anchored readouts ---------------------------------------------

    @Test
    fun nodesCarryLabelValueFormattedAndPosition() {
        // solar 2.5 kW, grid 1.5 kW (exporting), home 1.0 kW, battery 0.8 kW.
        val display = project(LivePowerStatus(solarW = 2500.0, batteryW = -800.0, gridW = -1500.0, homeW = 1000.0))

        val solar = nodeById(display, LivePowerFlowProjection.NODE_SOLAR)
        assertEquals("Solar", solar.label)
        assertEquals(2.5, solar.value, 0.0)
        assertEquals("2.5 kW", solar.formattedValue)
        assertEquals(PowerFlowGlyph.Solar, solar.glyph)
        assertEquals(PowerFlowPosition.Top, solar.position)
        assertEquals("Solar 2.5 kW", solar.contentDescription)

        val grid = nodeById(display, LivePowerFlowProjection.NODE_GRID)
        assertEquals(PowerFlowPosition.Left, grid.position)
        assertEquals(1.5, grid.value, 0.0)
        assertEquals("Grid 1.5 kW", grid.contentDescription)

        val home = nodeById(display, LivePowerFlowProjection.NODE_HOME)
        assertEquals(PowerFlowPosition.Right, home.position)
        assertEquals("Home 1.0 kW", home.contentDescription)

        val battery = nodeById(display, LivePowerFlowProjection.NODE_BATTERY)
        assertEquals(PowerFlowPosition.Bottom, battery.position)
        assertEquals(0.8, battery.value, 0.0)
        assertEquals("Battery 0.8 kW", battery.contentDescription)
    }

    @Test
    fun nodeValuesUseAbsoluteKw() {
        // Negative wire values still render as positive readouts (web Math.abs).
        val display = project(LivePowerStatus(solarW = 0.0, batteryW = -2000.0, gridW = -1000.0, homeW = 1500.0))
        assertEquals(2.0, nodeById(display, LivePowerFlowProjection.NODE_BATTERY).value, 0.0)
        assertEquals(1.0, nodeById(display, LivePowerFlowProjection.NODE_GRID).value, 0.0)
    }

    // ---- arrows: the six directional flows -----------------------------------------

    @Test
    fun solarProducingChargingAndImportingArrows() {
        // solar 3 kW, battery +1 kW (charging), grid +0.5 kW (importing), home 2.5 kW.
        val display = project(LivePowerStatus(solarW = 3000.0, batteryW = 1000.0, gridW = 500.0, homeW = 2500.0))

        val solarHome = arrow(display, LivePowerFlowProjection.NODE_SOLAR, LivePowerFlowProjection.NODE_HOME)!!
        assertTrue(solarHome.active)
        assertEquals(3.0, solarHome.magnitude, 0.0)
        assertEquals(PowerFlowTint.Solar, solarHome.tint)

        val solarBattery = arrow(display, LivePowerFlowProjection.NODE_SOLAR, LivePowerFlowProjection.NODE_BATTERY)!!
        assertTrue(solarBattery.active)
        // min(solarKw, abs(batteryKw)) = min(3, 1) = 1.
        assertEquals(1.0, solarBattery.magnitude, 0.0)
        assertEquals(PowerFlowTint.Solar, solarBattery.tint)

        val gridHome = arrow(display, LivePowerFlowProjection.NODE_GRID, LivePowerFlowProjection.NODE_HOME)!!
        assertTrue(gridHome.active)
        assertEquals(0.5, gridHome.magnitude, 0.0)
        assertEquals(PowerFlowTint.Grid, gridHome.tint)

        // No discharge / export / grid-charge flows in this scenario.
        assertNull(arrow(display, LivePowerFlowProjection.NODE_BATTERY, LivePowerFlowProjection.NODE_HOME))
        assertNull(arrow(display, LivePowerFlowProjection.NODE_HOME, LivePowerFlowProjection.NODE_GRID))
        assertNull(arrow(display, LivePowerFlowProjection.NODE_GRID, LivePowerFlowProjection.NODE_BATTERY))
    }

    @Test
    fun batteryDischargeAndGridExportArrows() {
        // solar 0, battery -2 kW (discharging), grid -1 kW (exporting), home 1 kW.
        val display = project(LivePowerStatus(solarW = 0.0, batteryW = -2000.0, gridW = -1000.0, homeW = 1000.0))

        val batteryHome = arrow(display, LivePowerFlowProjection.NODE_BATTERY, LivePowerFlowProjection.NODE_HOME)!!
        assertTrue(batteryHome.active)
        assertEquals(2.0, batteryHome.magnitude, 0.0)
        assertEquals(PowerFlowTint.Battery, batteryHome.tint)

        val homeGrid = arrow(display, LivePowerFlowProjection.NODE_HOME, LivePowerFlowProjection.NODE_GRID)!!
        assertTrue(homeGrid.active)
        assertEquals(1.0, homeGrid.magnitude, 0.0)
        assertEquals(PowerFlowTint.Home, homeGrid.tint)

        // No solar / import flows when solar is idle and grid is exporting.
        assertNull(arrow(display, LivePowerFlowProjection.NODE_SOLAR, LivePowerFlowProjection.NODE_HOME))
        assertNull(arrow(display, LivePowerFlowProjection.NODE_GRID, LivePowerFlowProjection.NODE_HOME))
    }

    @Test
    fun gridChargesBatteryWhenNoSolar() {
        // solar 0, battery +1.5 kW (charging), grid +2 kW (importing), home 0.5 kW.
        val display = project(LivePowerStatus(solarW = 0.0, batteryW = 1500.0, gridW = 2000.0, homeW = 500.0))

        val gridBattery = arrow(display, LivePowerFlowProjection.NODE_GRID, LivePowerFlowProjection.NODE_BATTERY)!!
        assertTrue(gridBattery.active)
        assertEquals(1.5, gridBattery.magnitude, 0.0)
        assertEquals(PowerFlowTint.Grid, gridBattery.tint)

        // Grid also feeds the home; battery is charged from the grid (no solar → no solar→battery flow).
        assertTrue(arrow(display, LivePowerFlowProjection.NODE_GRID, LivePowerFlowProjection.NODE_HOME)!!.active)
        assertNull(arrow(display, LivePowerFlowProjection.NODE_SOLAR, LivePowerFlowProjection.NODE_BATTERY))
    }

    @Test
    fun solarHomeArrowInactiveBelowThreshold() {
        // 5 W → 0.005 kW: arrow is present but inactive (web active: solarKw > 0.01).
        val low = project(LivePowerStatus(solarW = 5.0, batteryW = 0.0, gridW = 0.0, homeW = 0.0))
        assertFalse(arrow(low, LivePowerFlowProjection.NODE_SOLAR, LivePowerFlowProjection.NODE_HOME)!!.active)

        // 20 W → 0.02 kW: now active.
        val high = project(LivePowerStatus(solarW = 20.0, batteryW = 0.0, gridW = 0.0, homeW = 0.0))
        assertTrue(arrow(high, LivePowerFlowProjection.NODE_SOLAR, LivePowerFlowProjection.NODE_HOME)!!.active)
    }

    @Test
    fun allZeroPowersYieldNodesButNoArrows() {
        val display = project(LivePowerStatus(solarW = 0.0, batteryW = 0.0, gridW = 0.0, homeW = 0.0))
        assertEquals(4, display.nodes.size)
        assertTrue(display.arrows.isEmpty())
        assertTrue(display.hasData)
    }

    // ---- empty gates ----------------------------------------------------------------

    @Test
    fun noStatusYieldsNoDataDisplay() {
        val display = project(status = null, hasSites = true)
        assertTrue(display.hasSites)
        assertFalse(display.hasData)
        assertTrue(display.nodes.isEmpty())
        assertTrue(display.arrows.isEmpty())
        assertEquals("No live power data", display.noDataMessage)
    }

    @Test
    fun noSiteYieldsNoSiteDisplay() {
        val display = project(status = null, hasSites = false)
        assertFalse(display.hasSites)
        assertFalse(display.hasData)
        assertEquals("No Tesla Energy site linked", display.noSiteMessage)
    }

    // ---- footprint flag (web size.cols <= 1) ----------------------------------------

    @Test
    fun isCompactAtSingleColumnOnly() {
        assertTrue(LivePowerFlowSize(cols = 1, rows = 4).isCompact)
        assertFalse(LivePowerFlowSize(cols = 2, rows = 4).isCompact)
        assertFalse(LivePowerFlowSize(cols = 4, rows = 4).isCompact)
    }

    // ---- parsing: energy sites ------------------------------------------------------

    @Test
    fun parseEnergySitesReadsFirstSiteId() {
        val summary = parseEnergySites(sitesJson(siteId = 12345L))
        assertTrue(summary.hasSites)
        assertEquals(12345L, summary.firstSiteId)
    }

    @Test
    fun parseEnergySitesEmptyArrayHasNoSite() {
        val summary = parseEnergySites(emptySitesJson())
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseEnergySitesFirstRowWithoutIdStillHasSites() {
        val summary = parseEnergySites(sitesJson(siteId = null))
        assertTrue(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    @Test
    fun parseEnergySitesNonArrayHasNoSite() {
        val summary = parseEnergySites(liveJson(solar = 1.0))
        assertFalse(summary.hasSites)
        assertNull(summary.firstSiteId)
    }

    // ---- parsing: live status -------------------------------------------------------

    @Test
    fun parseLiveStatusReadsAllPowerFields() {
        val status = parseLiveStatus(liveJson(solar = 2500.0, battery = -800.0, grid = -1500.0, load = 1000.0))!!
        assertEquals(2500.0, status.solarW, 0.0)
        assertEquals(-800.0, status.batteryW, 0.0)
        assertEquals(-1500.0, status.gridW, 0.0)
        assertEquals(1000.0, status.homeW, 0.0)
    }

    @Test
    fun parseLiveStatusMissingFieldsCollapseToZero() {
        val status = parseLiveStatus(liveJson(solar = 1000.0))!!
        assertEquals(1000.0, status.solarW, 0.0)
        assertEquals(0.0, status.batteryW, 0.0)
        assertEquals(0.0, status.gridW, 0.0)
        assertEquals(0.0, status.homeW, 0.0)
    }

    @Test
    fun parseLiveStatusNullOrEmptyYieldsNull() {
        assertNull(parseLiveStatus(null))
        assertNull(parseLiveStatus(emptyObjectJson()))
        assertNull(parseLiveStatus(emptySitesJson()))
    }

    // ---- registry metadata (web registry/energy.ts) --------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("live-power-flow", LivePowerFlowRegistration.ID)
        assertEquals("energy", LivePowerFlowRegistration.CATEGORY)
        assertEquals("LivePowerFlowWidget", LivePowerFlowRegistration.SLUG)
        assertEquals(LivePowerFlowSize(cols = 2, rows = 4), LivePowerFlowRegistration.defaultSize)
        assertEquals(LivePowerFlowSize(cols = 2, rows = 4), LivePowerFlowRegistration.minSize)
        assertEquals(LivePowerFlowSize(cols = 4, rows = 40), LivePowerFlowRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(LivePowerFlowRegistration.isWithinBounds(LivePowerFlowSize(cols = 2, rows = 4)))
        assertFalse(LivePowerFlowRegistration.isWithinBounds(LivePowerFlowSize(cols = 1, rows = 4)))
        assertFalse(LivePowerFlowRegistration.isWithinBounds(LivePowerFlowSize(cols = 5, rows = 50)))
        assertEquals(
            LivePowerFlowSize(cols = 2, rows = 4),
            LivePowerFlowRegistration.clamp(LivePowerFlowSize(cols = 1, rows = 1)),
        )
        assertEquals(
            LivePowerFlowSize(cols = 4, rows = 40),
            LivePowerFlowRegistration.clamp(LivePowerFlowSize(cols = 9, rows = 99)),
        )
    }

    // ---- formatters -----------------------------------------------------------------

    @Test
    fun kwFormatsOneDecimalWithUnitAndAbsoluteValue() {
        assertEquals("2.5 kW", LivePowerFlowProjection.kw(2.5))
        assertEquals("1.5 kW", LivePowerFlowProjection.kw(-1.5))
        assertEquals("0.0 kW", LivePowerFlowProjection.kw(0.0))
    }

    @Test
    fun formatNumberGroupsThousandsWithFixedDigits() {
        assertEquals("1,234.6", LivePowerFlowProjection.formatNumber(1234.56, 1))
        assertEquals("7", LivePowerFlowProjection.formatNumber(7.0, 0))
    }

    @Test
    fun nonFinitePowerCollapsesToZero() {
        val display =
            project(LivePowerStatus(solarW = Double.NaN, batteryW = Double.POSITIVE_INFINITY, gridW = 0.0, homeW = 0.0))
        assertEquals(0.0, nodeById(display, LivePowerFlowProjection.NODE_SOLAR).value, 0.0)
        assertEquals(0.0, nodeById(display, LivePowerFlowProjection.NODE_BATTERY).value, 0.0)
    }

    private fun renderRelative(age: FreshnessAge): String =
        when (age) {
            FreshnessAge.Unknown -> "\u2014"
            FreshnessAge.JustNow -> "just now"
            is FreshnessAge.Seconds -> "${age.value}s ago"
            is FreshnessAge.Minutes -> "${age.value}m ago"
            is FreshnessAge.Hours -> "${age.value}h ago"
            is FreshnessAge.Days -> "${age.value}d ago"
            is FreshnessAge.Weeks -> "${age.value}w ago"
        }
}
