package io.teslasync.android.featureviews.drivingtab

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

/**
 * Off-device verification of the Driving analytics tab's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/analytics/components/analytics/DrivingTab.tsx): the
 * `safe` finite-or-zero guard, the per-chart series + axis-label projections (counts, ranges, hour labels,
 * short dates, the efficiency-trend `> 0` filter), the temperature-vs-efficiency scatter conversions
 * (°C/Wh/km/km -> display units) with its preserved order + bounds, the normalization + area-based bubble
 * radius math, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class DrivingTabProjectionTest {
    private val speedBuckets =
        listOf(
            DistributionBucket(range = "0-20", count = 4),
            DistributionBucket(range = "20-40", count = 9),
            DistributionBucket(range = "40-60", count = 0),
        )

    // ── safe() finite-or-zero guard ───────────────────────────────────────────────

    @Test
    fun safeKeepsFiniteValuesAndZeroesNullOrNonFinite() {
        assertEquals(12.5, DrivingProjection.safe(12.5), EPSILON)
        assertEquals(0.0, DrivingProjection.safe(null), EPSILON)
        assertEquals(0.0, DrivingProjection.safe(Double.NaN), EPSILON)
        assertEquals(0.0, DrivingProjection.safe(Double.POSITIVE_INFINITY), EPSILON)
        assertEquals(0.0, DrivingProjection.safe(Double.NEGATIVE_INFINITY), EPSILON)
    }

    // ── Bar projections ────────────────────────────────────────────────────────────

    @Test
    fun countsWidensBucketCountsAndRangesPreserveOrder() {
        assertEquals(listOf(4.0, 9.0, 0.0), DrivingProjection.counts(speedBuckets))
        assertEquals(listOf("0-20", "20-40", "40-60"), DrivingProjection.ranges(speedBuckets))
    }

    // ── Hourly + daily axis labels and values ───────────────────────────────────────

    @Test
    fun hourLabelFormatsHourWithLeadingColonZero() {
        assertEquals("0:00", DrivingProjection.hourLabel(0))
        assertEquals("17:00", DrivingProjection.hourLabel(17))
    }

    @Test
    fun hourlySeriesProjectDrivesAndDistance() {
        val points =
            listOf(
                HourlyDrivePoint(hour = 7, drives = 3, distance = 22.0),
                HourlyDrivePoint(hour = 8, drives = 6, distance = Double.NaN),
            )
        assertEquals(listOf("7:00", "8:00"), DrivingProjection.hourLabels(points))
        assertEquals(listOf(3.0, 6.0), DrivingProjection.drivesValues(points))
        // The second distance is non-finite -> safe() zeroes it (web `safe`).
        assertEquals(listOf(22.0, 0.0), DrivingProjection.hourlyDistanceValues(points))
    }

    @Test
    fun shortDateStripsTheYearPrefixLikeSliceFive() {
        assertEquals("04-04", DrivingProjection.shortDate("2026-04-04"))
        assertEquals("12-25", DrivingProjection.shortDate("2026-12-25"))
        // Inputs shorter than the prefix are returned unchanged (no exception).
        assertEquals("x", DrivingProjection.shortDate("x"))
    }

    @Test
    fun dailySeriesProjectDistanceDrivesAndShortDates() {
        val points =
            listOf(
                DailyDrivePoint(date = "2026-04-02", drives = 3, distance = 40.0, efficiency = 168.0),
                DailyDrivePoint(date = "2026-04-03", drives = 5, distance = 62.0, efficiency = null),
            )
        assertEquals(listOf("04-02", "04-03"), DrivingProjection.shortDates(points))
        assertEquals(listOf(40.0, 62.0), DrivingProjection.dailyDistanceValues(points))
        assertEquals(listOf(3.0, 5.0), DrivingProjection.dailyDrivesValues(points))
    }

    // ── Efficiency trend filter (web `filter(d => safe(d.efficiency) > 0)`) ──────────

    @Test
    fun efficiencyTrendKeepsOnlyPositiveFiniteEfficiency() {
        val points =
            listOf(
                DailyDrivePoint("2026-04-01", 1, 1.0, 168.0),
                DailyDrivePoint("2026-04-02", 1, 1.0, null),
                DailyDrivePoint("2026-04-03", 1, 1.0, 0.0),
                DailyDrivePoint("2026-04-04", 1, 1.0, -5.0),
                DailyDrivePoint("2026-04-05", 1, 1.0, 150.0),
            )
        val trend = DrivingProjection.efficiencyTrend(points)
        assertEquals(listOf("2026-04-01", "2026-04-05"), trend.map { it.date })
        assertEquals(listOf(168.0, 150.0), DrivingProjection.efficiencyValues(trend))
    }

    // ── Efficiency unit symbol ───────────────────────────────────────────────────────

    @Test
    fun efficiencyUnitLabelDerivesFromDistanceUnit() {
        assertEquals("Wh/km", DrivingProjection.efficiencyUnitLabel(DistanceUnitPref.KM))
        assertEquals("Wh/mi", DrivingProjection.efficiencyUnitLabel(DistanceUnitPref.MI))
    }

    // ── Scatter projection: metric (no conversion beyond km bubble round-trip) ────────

    @Test
    fun scatterProjectMetricKeepsCelsiusAndWhPerKmAndKmBubble() {
        val projection =
            DrivingScatter.project(
                samples = SCATTER_SAMPLES,
                distance = DistanceUnitPref.KM,
                temperature = TemperatureUnitPref.CELSIUS,
            )

        assertFalse(projection.isEmpty)
        assertEquals(3, projection.points.size)
        // First point: temp 5 °C stays 5, efficiency 182 Wh/km stays, distance 12 km round-trips to 12.
        assertEquals(5.0, projection.points[0].x, EPSILON)
        assertEquals(182.0, projection.points[0].y, EPSILON)
        assertEquals(12.0, projection.points[0].size, EPSILON)
        // Bounds span every observation.
        assertEquals(5.0, projection.xMin, EPSILON)
        assertEquals(30.0, projection.xMax, EPSILON)
        assertEquals(150.0, projection.yMin, EPSILON)
        assertEquals(182.0, projection.yMax, EPSILON)
        assertEquals(8.0, projection.sizeMin, EPSILON)
        assertEquals(25.0, projection.sizeMax, EPSILON)
    }

    // ── Scatter projection: imperial (°F, Wh/mi, mi) ──────────────────────────────────

    @Test
    fun scatterProjectImperialConvertsTempEfficiencyAndDistance() {
        val projection =
            DrivingScatter.project(
                samples = SCATTER_SAMPLES,
                distance = DistanceUnitPref.MI,
                temperature = TemperatureUnitPref.FAHRENHEIT,
            )

        // 5 °C -> 41 °F; 182 Wh/km -> 182 × KM_PER_MILE Wh/mi; 12 km bubble -> miles via shared converter.
        assertEquals(41.0, projection.points[0].x, EPSILON)
        assertEquals(182.0 * KM_PER_MILE, projection.points[0].y, EPSILON)
        assertEquals(convertDistanceFromSI(12_000.0, DistanceUnitPref.MI), projection.points[0].size, EPSILON)
    }

    @Test
    fun scatterProjectEmptySamplesYieldsEmptyZeroBoundsProjection() {
        val projection =
            DrivingScatter.project(
                samples = emptyList(),
                distance = DistanceUnitPref.KM,
                temperature = TemperatureUnitPref.CELSIUS,
            )

        assertTrue(projection.isEmpty)
        assertTrue(projection.points.isEmpty())
        assertEquals(0.0, projection.xMax, EPSILON)
        assertEquals(0.0, projection.sizeMax, EPSILON)
    }

    // ── Normalization + bubble radius math ────────────────────────────────────────────

    @Test
    fun normalizeMapsValueIntoUnitIntervalAndClamps() {
        assertEquals(0.0, DrivingScatter.normalize(0.0, 0.0, 10.0), EPSILON)
        assertEquals(0.5, DrivingScatter.normalize(5.0, 0.0, 10.0), EPSILON)
        assertEquals(1.0, DrivingScatter.normalize(10.0, 0.0, 10.0), EPSILON)
        // Out-of-range values clamp to the unit interval.
        assertEquals(0.0, DrivingScatter.normalize(-5.0, 0.0, 10.0), EPSILON)
        assertEquals(1.0, DrivingScatter.normalize(15.0, 0.0, 10.0), EPSILON)
    }

    @Test
    fun normalizeCentersDegenerateRange() {
        assertEquals(0.5, DrivingScatter.normalize(7.0, 7.0, 7.0), EPSILON)
        assertEquals(0.5, DrivingScatter.normalize(7.0, 10.0, 5.0), EPSILON)
    }

    @Test
    fun radiusFractionIsSqrtOfNormalizedSizeForAreaScaling() {
        assertEquals(0.0, DrivingScatter.radiusFraction(0.0, 0.0, 100.0), EPSILON)
        assertEquals(1.0, DrivingScatter.radiusFraction(100.0, 0.0, 100.0), EPSILON)
        assertEquals(sqrt(0.5), DrivingScatter.radiusFraction(50.0, 0.0, 100.0), EPSILON)
    }

    // ── DrivingAnalytics emptiness ──────────────────────────────────────────────────

    @Test
    fun isEmptyTrueOnlyWhenEverySeriesIsEmpty() {
        assertTrue(DrivingAnalytics.EMPTY.isEmpty)
        assertFalse(DrivingAnalytics(speedDistribution = speedBuckets).isEmpty)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordDrivingTabOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DrivingTab"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }

    private companion object {
        private const val EPSILON = 1e-9

        private val SCATTER_SAMPLES =
            listOf(
                TempEfficiencySample(temp = 5.0, efficiency = 182.0, distance = 12.0),
                TempEfficiencySample(temp = 18.0, efficiency = 150.0, distance = 25.0),
                TempEfficiencySample(temp = 30.0, efficiency = 165.0, distance = 8.0),
            )
    }
}
