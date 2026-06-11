package io.teslasync.android.dashboard.widgets.speedheatmap

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.SpeedUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

/**
 * Off-device verification of the SpeedHeatmapWidget's pure logic — the `buildHeatmap` day/hour bucketing,
 * the SI-mps → display-unit speed conversion (web `convertSpeedFromSI`), the `maxSpeed`/`totalDrives`
 * reductions, the `speedToColor` cool→hot ramp, the legend samples, the compact peak metric with its `—`
 * fallback, the per-footprint labels, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx).
 */
class SpeedHeatmapProjectionTest {
    private val strings = speedHeatmapStrings()
    private val utc = ZoneId.of("UTC")

    private fun project(
        drives: List<Drive>,
        size: SpeedHeatmapSize = SpeedHeatmapSize(cols = 2, rows = 4),
        speed: SpeedUnitPref = SpeedUnitPref.KMH,
    ) = SpeedHeatmapProjection.project(drives, unitPref(speed), strings, size, utc)

    /** Epoch millis for a UTC wall-clock time (so the day/hour bucket is deterministic under `utc`). */
    private fun utcMillis(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
    ): Long = ZonedDateTime.of(year, month, day, hour, 0, 0, 0, ZoneOffset.UTC).toInstant().toEpochMilli()

    @Test
    fun bucketsDriveIntoLocalDayAndHour() {
        // 2024-01-01 is a Monday → day index 0; 09:00 → hour 9. 10 m/s → 36 km/h.
        val display = project(listOf(drive(id = 1, startTsMillis = utcMillis(2024, 1, 1, 9), avgSpeedMps = 10.0)))

        assertTrue(display.hasData)
        assertEquals(1, display.totalDrives)
        val cell = display.cells[0 * COLS + 9]
        assertEquals(0, cell.day)
        assertEquals(9, cell.hour)
        assertEquals(1, cell.count)
        assertEquals(36.0, cell.avgSpeed, EPSILON)
        assertTrue(cell.paint.filled)
        assertEquals(36.0, display.maxSpeed, EPSILON)
        // An unrelated bucket stays empty.
        val empty = display.cells[1 * COLS + 0]
        assertEquals(0, empty.count)
        assertFalse(empty.paint.filled)
    }

    @Test
    fun fallsBackToMaxSpeedWhenAvgMissing() {
        val display =
            project(listOf(drive(id = 1, startTsMillis = utcMillis(2024, 1, 1, 9), avgSpeedMps = null, maxSpeedMps = 5.0)))
        // 5 m/s → 18 km/h.
        assertEquals(18.0, display.cells[9].avgSpeed, EPSILON)
        assertEquals(1, display.totalDrives)
    }

    @Test
    fun averagesMultipleDrivesInTheSameBucket() {
        val ts = utcMillis(2024, 1, 1, 9)
        val display =
            project(listOf(drive(id = 1, startTsMillis = ts, avgSpeedMps = 10.0), drive(id = 2, startTsMillis = ts, avgSpeedMps = 20.0)))
        // avg(10, 20) = 15 m/s → 54 km/h.
        assertEquals(2, display.cells[9].count)
        assertEquals(54.0, display.cells[9].avgSpeed, EPSILON)
        assertEquals(2, display.totalDrives)
    }

    @Test
    fun skipsDrivesWithoutPositiveSpeed() {
        val ts = utcMillis(2024, 1, 1, 9)
        val display =
            project(
                listOf(
                    drive(id = 1, startTsMillis = ts, avgSpeedMps = null, maxSpeedMps = null),
                    drive(id = 2, startTsMillis = ts, avgSpeedMps = 0.0),
                ),
            )
        assertEquals(0, display.totalDrives)
        assertFalse(display.hasData)
        assertEquals("No drive data yet", display.emptyText)
    }

    @Test
    fun convertsSpeedToTheUsersUnit() {
        val display =
            project(listOf(drive(id = 1, startTsMillis = utcMillis(2024, 1, 1, 9), avgSpeedMps = 10.0)), speed = SpeedUnitPref.MPH)
        // 10 m/s = 22.369… mph → 1 cell, 0-dp summary.
        assertEquals(22.37, display.cells[9].avgSpeed, EPSILON)
        assertEquals("22", display.peakValueText)
        assertEquals("Peak avg 22 mph", display.peakSpeedSummaryText)
        assertEquals("1 drives", display.drivesSummaryText)
    }

    @Test
    fun footprintControlsTitleAndLabels() {
        val wide = project(emptyList(), size = SpeedHeatmapSize(cols = 3, rows = 4))
        assertTrue(wide.isWide)
        assertTrue(wide.showTitle)
        assertEquals(listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), wide.dayLabels)
        assertEquals(listOf(0, 3, 6, 9, 12, 15, 18, 21), wide.hourLabels)

        val standard = project(emptyList(), size = SpeedHeatmapSize(cols = 2, rows = 4))
        assertFalse(standard.isCompact)
        assertEquals(listOf("M", "T", "W", "T", "F", "S", "S"), standard.dayLabels)
        assertEquals(listOf(0, 6, 12, 18), standard.hourLabels)
    }

    @Test
    fun compactPeakMetricUsesEmDashWhenEmpty() {
        val withData =
            project(listOf(drive(id = 1, startTsMillis = utcMillis(2024, 1, 1, 9), avgSpeedMps = 10.0)), size = SpeedHeatmapSize(1, 4))
        assertTrue(withData.isCompact)
        assertFalse(withData.showTitle)
        assertEquals("36", withData.peakValueText)
        assertEquals("Peak km/h", withData.peakLabelText)

        val empty = project(emptyList(), size = SpeedHeatmapSize(1, 4))
        assertEquals("\u2014", empty.peakValueText)
    }

    @Test
    fun cellGridIsSevenByTwentyFour() {
        assertEquals(ROWS * COLS, project(emptyList()).cells.size)
    }

    @Test
    fun legendHasFiveSwatchesColdToHot() {
        val display = project(listOf(drive(id = 1, startTsMillis = utcMillis(2024, 1, 1, 9), avgSpeedMps = 10.0)))
        assertEquals(5, display.legend.size)
        // Stop 0 is the empty fill; stop 1 is the hottest (red-500).
        assertFalse(display.legend.first().filled)
        assertTrue(display.legend.last().filled)
        assertEquals(HeatPaint(filled = true, red = 239, green = 68, blue = 68), display.legend.last())
    }

    @Test
    fun speedToColorRampMatchesWeb() {
        assertFalse(SpeedHeatmapProjection.speedToColor(0.0, 10.0).filled)
        assertFalse(SpeedHeatmapProjection.speedToColor(10.0, 0.0).filled)
        // t = 1 → the final stop (red-500).
        assertEquals(HeatPaint(true, 239, 68, 68), SpeedHeatmapProjection.speedToColor(10.0, 10.0))
        // t = 0.5 → midpoint of segment 1 (cyan→amber).
        assertEquals(HeatPaint(true, 126, 170, 112), SpeedHeatmapProjection.speedToColor(5.0, 10.0))
    }

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("speed-heatmap", SpeedHeatmapRegistration.ID)
        assertEquals("driving", SpeedHeatmapRegistration.CATEGORY)
        assertEquals("SpeedHeatmapWidget", SpeedHeatmapRegistration.SLUG)
        assertEquals(SpeedHeatmapSize(2, 4), SpeedHeatmapRegistration.defaultSize)
        assertEquals(SpeedHeatmapSize(1, 4), SpeedHeatmapRegistration.minSize)
        assertEquals(SpeedHeatmapSize(4, 40), SpeedHeatmapRegistration.maxSize)
    }

    @Test
    fun clampHonoursTheMinMaxFootprint() {
        assertTrue(SpeedHeatmapRegistration.withinBounds(SpeedHeatmapRegistration.defaultSize))
        assertTrue(SpeedHeatmapRegistration.withinBounds(SpeedHeatmapSize(1, 4)))
        assertFalse(SpeedHeatmapRegistration.withinBounds(SpeedHeatmapSize(0, 4)))
        assertFalse(SpeedHeatmapRegistration.withinBounds(SpeedHeatmapSize(5, 40)))
        assertEquals(SpeedHeatmapSize(1, 4), SpeedHeatmapRegistration.clamp(SpeedHeatmapSize(0, 1)))
        assertEquals(SpeedHeatmapSize(4, 40), SpeedHeatmapRegistration.clamp(SpeedHeatmapSize(9, 99)))
    }

    private companion object {
        const val EPSILON = 0.01
    }
}
