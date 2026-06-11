package io.teslasync.android.dashboard.widgets.driveefficiencychart

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import kotlin.time.Instant

/**
 * Off-device verification of the DriveEfficiencyChartWidget's pure logic — the `estimateEfficiency`
 * heuristic, the daily grouping + rolling-average fold, the trailing-30-day filter, the SI→display
 * unit conversion, the Avg / Best day / Trend rollups, the registry metadata, and the footprint
 * branches. Mirrors the web spec
 * (web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx). Runs in the
 * `:android:testReleaseUnitTest` gate.
 */
class DriveEfficiencyProjectionTest {
    private val strings =
        DriveEfficiencyStrings(
            avg = "Avg",
            best = "Best day",
            trend = "Trend",
            daily = "Daily",
            rolling = "7-day avg",
        )

    private val now = dayMillis(2023, 11, 15)

    // ---- estimateEfficiencyWhPerKm (web `estimateEfficiency`) ----------------------

    @Test
    fun estimatesWhPerKmFromMeasuredEnergy() {
        // 10 km, 1500 Wh -> 150 Wh/km.
        val eff = DriveEfficiencyProjection.estimateEfficiencyWhPerKm(drive(now, distanceM = 10_000.0, energyUsedWh = 1_500.0))
        assertEquals(150.0, eff!!, EPSILON)
    }

    @Test
    fun skipsTinyDrivesUnderEightHundredMeters() {
        assertNull(DriveEfficiencyProjection.estimateEfficiencyWhPerKm(drive(now, distanceM = 500.0, energyUsedWh = 100.0)))
    }

    @Test
    fun rejectsImplausiblyLowEfficiency() {
        // 100 km, 1000 Wh -> 10 Wh/km (< 30) -> rejected.
        assertNull(DriveEfficiencyProjection.estimateEfficiencyWhPerKm(drive(now, distanceM = 100_000.0, energyUsedWh = 1_000.0)))
    }

    @Test
    fun rejectsImplausiblyHighEfficiency() {
        // 1 km, 1000 Wh -> 1000 Wh/km (> 500) -> rejected.
        assertNull(DriveEfficiencyProjection.estimateEfficiencyWhPerKm(drive(now, distanceM = 1_000.0, energyUsedWh = 1_000.0)))
    }

    @Test
    fun fallsBackToBatteryDeltaWhenNoEnergy() {
        // 20 km, 50% -> 45% = 5% used -> 5 * 0.75 * 1000 / 20 = 187.5 Wh/km.
        val eff =
            DriveEfficiencyProjection.estimateEfficiencyWhPerKm(
                drive(now, distanceM = 20_000.0, energyUsedWh = null, startBatteryPct = 50, endBatteryPct = 45),
            )
        assertEquals(187.5, eff!!, EPSILON)
    }

    @Test
    fun fallbackRejectsNonPositiveBatteryDelta() {
        assertNull(
            DriveEfficiencyProjection.estimateEfficiencyWhPerKm(
                drive(now, distanceM = 20_000.0, energyUsedWh = null, startBatteryPct = 40, endBatteryPct = 50),
            ),
        )
    }

    @Test
    fun returnsNullWhenNeitherEnergyNorBatteryAvailable() {
        assertNull(DriveEfficiencyProjection.estimateEfficiencyWhPerKm(drive(now, distanceM = 20_000.0)))
    }

    // ---- project: daily grouping, rolling avg, stats (web memos) -------------------

    @Test
    fun projectsDailySeriesWithRollingAverage() {
        val display = project(fourDayFixture())
        assertTrue(display.hasData)
        assertEquals(4, display.points.size)

        // Daily averages (Wh/km), oldest-first.
        assertEquals(listOf(100.0, 200.0, 300.0, 120.0), display.points.map { it.efficiency })
        // Rolling avg is null on day 1 (needs >= 2 days), then the running mean.
        assertNull(display.points[0].rollingAvg)
        assertEquals(150.0, display.points[1].rollingAvg!!, EPSILON)
        assertEquals(200.0, display.points[2].rollingAvg!!, EPSILON)
        assertEquals(180.0, display.points[3].rollingAvg!!, EPSILON)
    }

    @Test
    fun rollsUpAvgBestAndTrendStats() {
        val display = project(fourDayFixture())
        val avg = display.stats[0]
        val best = display.stats[1]
        val trend = display.stats[2]

        assertEquals("Avg", avg.label)
        assertEquals("180", avg.value)
        assertEquals("Wh/km", avg.unit)

        assertEquals("Best day", best.label)
        assertEquals("100", best.value)

        // first half avg 150, second half avg 210 -> +40%.
        assertEquals("Trend", trend.label)
        assertEquals("+40%", trend.value)
        assertNull(trend.unit)
    }

    @Test
    fun trendIsNullDashWithFewerThanFourPoints() {
        val display = project(listOf(dayDrive(2023, 11, 10, 100.0), dayDrive(2023, 11, 11, 200.0)))
        assertEquals("\u2014", display.stats[2].value)
    }

    @Test
    fun convertsToMilesForImperialPreference() {
        val display = project(fourDayFixture(), distanceUnit = DistanceUnitPref.MI)
        assertEquals("Wh/mi", display.efficiencyUnit)
        // 100 Wh/km * 1.609344 -> 160.9 Wh/mi (one-decimal rounded).
        assertEquals(160.9, display.points[0].efficiency, EPSILON)
        assertEquals("Wh/mi", display.stats[0].unit)
    }

    @Test
    fun excludesDrivesOlderThanThirtyDays() {
        val old = dayDrive(2023, 9, 1, 250.0)
        val recent = dayDrive(2023, 11, 14, 150.0)
        val display = project(listOf(old, recent))
        assertEquals(1, display.points.size)
        assertEquals(150.0, display.points[0].efficiency, EPSILON)
    }

    @Test
    fun averagesMultipleDrivesOnTheSameDay() {
        val day = dayMillis(2023, 11, 12)
        val display =
            project(
                listOf(
                    drive(day, distanceM = 10_000.0, energyUsedWh = 1_000.0, id = 1), // 100
                    drive(day, distanceM = 10_000.0, energyUsedWh = 3_000.0, id = 2), // 300
                ),
            )
        assertEquals(1, display.points.size)
        assertEquals(200.0, display.points[0].efficiency, EPSILON)
    }

    @Test
    fun emptyWhenNoDriveYieldsPlausibleEfficiency() {
        // A single sub-threshold drive resolves to no chartable points (web `displayData.length === 0`).
        val display = project(listOf(drive(now, distanceM = 300.0, energyUsedWh = 100.0)))
        assertFalse(display.hasData)
        assertEquals("\u2014", display.stats[0].value)
    }

    // ---- registry + footprint metadata ---------------------------------------------

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("drive-efficiency-chart", DriveEfficiencyRegistration.ID)
        assertEquals("driving", DriveEfficiencyRegistration.CATEGORY)
        assertEquals("DriveEfficiencyChartWidget", DriveEfficiencyRegistration.SLUG)
        assertEquals(DriveEfficiencySize(2, 4), DriveEfficiencyRegistration.defaultSize)
        assertEquals(DriveEfficiencySize(1, 2), DriveEfficiencyRegistration.minSize)
        assertEquals(DriveEfficiencySize(4, 40), DriveEfficiencyRegistration.maxSize)
    }

    @Test
    fun footprintCompactAndWideBranchesMatchWeb() {
        assertTrue(DriveEfficiencySize(1, 1).isCompact)
        assertFalse(DriveEfficiencySize(1, 2).isCompact)
        assertTrue(DriveEfficiencySize(3, 4).isWide)
        assertFalse(DriveEfficiencySize(2, 4).isWide)
    }

    @Test
    fun clampHonoursMinAndMaxFootprint() {
        assertEquals(DriveEfficiencySize(1, 2), DriveEfficiencyRegistration.clamp(DriveEfficiencySize(0, 1)))
        assertEquals(DriveEfficiencySize(4, 40), DriveEfficiencyRegistration.clamp(DriveEfficiencySize(9, 99)))
        assertFalse(DriveEfficiencyRegistration.withinBounds(DriveEfficiencySize(5, 4)))
    }

    // ---- fixtures ------------------------------------------------------------------

    private fun project(
        drives: List<Drive>,
        distanceUnit: DistanceUnitPref = DistanceUnitPref.KM,
    ): DriveEfficiencyDisplay =
        DriveEfficiencyProjection.project(
            drives = drives,
            size = DriveEfficiencyRegistration.defaultSize,
            strings = strings,
            distanceUnit = distanceUnit,
            nowMillis = now,
            zone = ZoneOffset.UTC,
            locale = Locale.US,
        )

    private fun fourDayFixture(): List<Drive> =
        listOf(
            dayDrive(2023, 11, 10, 100.0),
            dayDrive(2023, 11, 11, 200.0),
            dayDrive(2023, 11, 12, 300.0),
            dayDrive(2023, 11, 13, 120.0),
        )

    /** A 10 km drive on the given UTC day whose measured energy yields exactly [whPerKm] Wh/km. */
    private fun dayDrive(
        year: Int,
        month: Int,
        day: Int,
        whPerKm: Double,
    ): Drive =
        drive(
            startTsMillis = dayMillis(year, month, day),
            distanceM = 10_000.0,
            energyUsedWh = whPerKm * 10.0,
            id = dayMillis(year, month, day),
        )

    @Suppress("LongParameterList")
    private fun drive(
        startTsMillis: Long,
        distanceM: Double,
        energyUsedWh: Double? = null,
        startBatteryPct: Long? = null,
        endBatteryPct: Long? = null,
        id: Long = startTsMillis,
    ): Drive =
        Drive(
            createdAt = Instant.fromEpochMilliseconds(startTsMillis),
            distanceM = distanceM,
            durationS = 0L,
            id = id,
            startTs = Instant.fromEpochMilliseconds(startTsMillis),
            updatedAt = Instant.fromEpochMilliseconds(startTsMillis),
            vehicleId = 1L,
            energyUsedWh = energyUsedWh,
            startBatteryPct = startBatteryPct,
            endBatteryPct = endBatteryPct,
        )

    private companion object {
        const val EPSILON = 0.0001
    }
}

private fun dayMillis(
    year: Int,
    month: Int,
    day: Int,
): Long =
    LocalDate
        .of(year, month, day)
        .atStartOfDay(ZoneOffset.UTC)
        .toInstant()
        .toEpochMilli()
