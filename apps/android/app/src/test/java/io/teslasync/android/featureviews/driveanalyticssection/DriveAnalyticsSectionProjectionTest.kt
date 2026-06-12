package io.teslasync.android.featureviews.driveanalyticssection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Drive Analytics section's pure logic — the native analogue of the web
 * component's data derivations
 * (web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx): the page `filteredDrives`
 * date filter, the `speedDistribution` bucketing (with the web's convert-both-sides edge comparison), the
 * `accelPatterns` scatter mapping (`Math.round` distance + W→kW) and its average reference line, the
 * `powerProfile` last-20 window (with the flat-zero regen baseline), the scatter normalization math, the
 * default date range, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class DriveAnalyticsSectionProjectionTest {
    // ── Date filter (web `filteredDrives` memo) ───────────────────────────────────────

    @Test
    fun filterByDateKeepsOnlyInclusiveRangeAndDropsMissingDates() {
        val drives =
            listOf(
                drive(startTs = "2026-04-02T08:00:00Z"),
                drive(startTs = "2026-04-20T17:30:00Z"),
                drive(startTs = "2026-03-01T07:10:00Z"),
                drive(startTs = null),
            )

        val filtered = DriveAnalyticsProjection.filterByDate(drives, "2026-04-01", "2026-04-15")

        assertEquals(listOf("2026-04-02T08:00:00Z"), filtered.map { it.startTs })
    }

    @Test
    fun filterByDateIsInclusiveOfBothEnds() {
        val drives = listOf(drive(startTs = "2026-04-01T00:00:00Z"), drive(startTs = "2026-04-15T23:59:00Z"))

        val filtered = DriveAnalyticsProjection.filterByDate(drives, "2026-04-01", "2026-04-15")

        assertEquals(2, filtered.size)
    }

    // ── Speed distribution (web `speedDistribution` memo) ─────────────────────────────

    @Test
    fun speedDistributionBucketsByRawMpsWithHalfOpenEdgesAndMetricLabels() {
        val drives =
            listOf(
                drive(avgSpeedMps = 10.0),
                drive(avgSpeedMps = 20.0),
                drive(avgSpeedMps = 30.0), // boundary -> the 30–60 bucket (web `spd >= lo && spd < hi`)
                drive(avgSpeedMps = 95.0),
                drive(avgSpeedMps = 130.0),
                drive(avgSpeedMps = null), // skipped (web `if (spd == null) continue`)
            )

        val buckets = DriveAnalyticsProjection.speedDistribution(drives, SpeedUnitPref.KMH)

        assertEquals(listOf(2L, 1L, 0L, 1L, 1L), buckets.map { it.count })
        assertEquals(
            listOf("0\u201330 km/h", "30\u201360 km/h", "60\u201390 km/h", "90\u2013120 km/h", "120+ km/h"),
            buckets.map { it.range },
        )
    }

    @Test
    fun speedDistributionImperialKeepsBucketingAndSwitchesUnitLabel() {
        // The convert-both-sides comparison cancels, so imperial buckets identically; only the label changes.
        val drives = listOf(drive(avgSpeedMps = 10.0), drive(avgSpeedMps = 30.0), drive(avgSpeedMps = 200.0))

        val buckets = DriveAnalyticsProjection.speedDistribution(drives, SpeedUnitPref.MPH)

        assertEquals(listOf(1L, 1L, 0L, 0L, 1L), buckets.map { it.count })
        assertEquals("0\u201330 mph", buckets.first().range)
        assertEquals("120+ mph", buckets.last().range)
    }

    @Test
    fun speedTotalSumsEveryBucketCount() {
        val drives = listOf(drive(avgSpeedMps = 10.0), drive(avgSpeedMps = 95.0))
        val buckets = DriveAnalyticsProjection.speedDistribution(drives, SpeedUnitPref.KMH)

        assertEquals(2L, DriveAnalyticsProjection.speedTotal(buckets))
        assertEquals(0L, DriveAnalyticsProjection.speedTotal(DriveAnalyticsProjection.speedDistribution(emptyList(), SpeedUnitPref.KMH)))
    }

    // ── Acceleration patterns (web `accelPatterns` memo) ──────────────────────────────

    @Test
    fun accelPatternsDropsNullPowerRoundsDistanceAndScalesPowerToKw() {
        val drives =
            listOf(
                drive(distanceM = 18_400.0, avgPowerW = 16_000.0),
                drive(distanceM = 42_100.0, avgPowerW = 38_500.0),
                drive(distanceM = 9_300.0, avgPowerW = null), // filtered out (web `filter(d => d.avgPowerW != null)`)
                drive(distanceM = 2_500.0, avgPowerW = 1_000.0), // 2.5 km rounds half-up to 3 (web `Math.round`)
            )

        val points = DriveAnalyticsProjection.accelPatterns(drives, DistanceUnitPref.KM)

        assertEquals(listOf(18.0, 42.0, 3.0), points.map { it.distance })
        assertEquals(listOf(16.0, 38.5, 1.0), points.map { it.powerMax })
    }

    @Test
    fun accelPatternsConvertsDistanceForImperial() {
        val points = DriveAnalyticsProjection.accelPatterns(listOf(drive(distanceM = 18_400.0, avgPowerW = 16_000.0)), DistanceUnitPref.MI)

        // 18_400 m / 1609.344 = 11.4338… mi -> Math.round -> 11.
        assertEquals(11.0, points.single().distance, EPSILON)
        assertEquals(16.0, points.single().powerMax, EPSILON)
    }

    @Test
    fun accelScatterDerivesBoundsAndAverageReferenceLine() {
        val points = listOf(AccelPoint(18.0, 16.0), AccelPoint(42.0, 38.5), AccelPoint(3.0, 1.0))

        val scatter = DriveAnalyticsProjection.accelScatter(points)

        assertFalse(scatter.isEmpty)
        assertEquals(3.0, scatter.xMin, EPSILON)
        assertEquals(42.0, scatter.xMax, EPSILON)
        assertEquals(1.0, scatter.yMin, EPSILON)
        assertEquals(38.5, scatter.yMax, EPSILON)
        assertEquals((16.0 + 38.5 + 1.0) / 3.0, scatter.avg!!, EPSILON)
    }

    @Test
    fun accelScatterEmptyHasZeroBoundsAndNoAverage() {
        val scatter = DriveAnalyticsProjection.accelScatter(emptyList())

        assertTrue(scatter.isEmpty)
        assertEquals(0.0, scatter.xMax, EPSILON)
        assertNull(scatter.avg)
    }

    // ── Power profile (web `powerProfile` memo) ───────────────────────────────────────

    @Test
    fun powerProfileMapsLabelPowerAndFlatZeroRegen() {
        val drives = listOf(drive(startTs = "A", avgPowerW = 16_000.0), drive(startTs = "B", avgPowerW = null))

        val points = DriveAnalyticsProjection.powerProfile(drives) { it ?: EM_DASH_TEST }

        assertEquals(listOf("A", "B"), points.map { it.label })
        assertEquals(listOf(16.0, 0.0), points.map { it.powerMax }) // null power -> 0 (web `avgPowerW ?? 0`)
        assertEquals(listOf(0.0, 0.0), points.map { it.powerMin }) // regen baseline is always 0 (web `powerMin: 0`)
    }

    @Test
    fun powerProfileKeepsOnlyTheLastTwentyDrives() {
        val drives = (1..25).map { drive(startTs = "d$it", avgPowerW = it * 1_000.0) }

        val points = DriveAnalyticsProjection.powerProfile(drives) { it ?: EM_DASH_TEST }

        assertEquals(RECENT_DRIVES_WINDOW, points.size)
        assertEquals("d6", points.first().label) // slice(-20) of 25 -> drives 6..25
        assertEquals("d25", points.last().label)
    }

    // ── Scatter normalization + jsRound math ──────────────────────────────────────────

    @Test
    fun normalizeMapsValueIntoUnitIntervalClampsAndCentersDegenerateRange() {
        assertEquals(0.0, DriveAnalyticsProjection.normalize(0.0, 0.0, 10.0), EPSILON)
        assertEquals(0.5, DriveAnalyticsProjection.normalize(5.0, 0.0, 10.0), EPSILON)
        assertEquals(1.0, DriveAnalyticsProjection.normalize(10.0, 0.0, 10.0), EPSILON)
        assertEquals(0.0, DriveAnalyticsProjection.normalize(-5.0, 0.0, 10.0), EPSILON)
        assertEquals(1.0, DriveAnalyticsProjection.normalize(15.0, 0.0, 10.0), EPSILON)
        assertEquals(0.5, DriveAnalyticsProjection.normalize(7.0, 7.0, 7.0), EPSILON)
    }

    @Test
    fun jsRoundRoundsHalfTowardPositiveInfinityNotToEven() {
        assertEquals(3.0, DriveAnalyticsProjection.jsRound(2.5), EPSILON)
        assertEquals(4.0, DriveAnalyticsProjection.jsRound(3.5), EPSILON) // kotlin.math.round would give 4 too…
        assertEquals(2.0, DriveAnalyticsProjection.jsRound(2.4), EPSILON)
        assertEquals(-2.0, DriveAnalyticsProjection.jsRound(-2.5), EPSILON) // …but here it differs (round-to-even -> -2 / +∞ -> -2)
    }

    // ── Default date range (web `today - 30 days` .. `today`) ─────────────────────────

    @Test
    fun defaultDateRangeIsTheTrailingThirtyDays() {
        assertEquals(70L, DriveAnalyticsProjection.defaultStartEpochDay(100L))
        assertEquals(100L, DriveAnalyticsProjection.defaultEndEpochDay(100L))
        val span = DriveAnalyticsProjection.defaultEndEpochDay(100L) - DriveAnalyticsProjection.defaultStartEpochDay(100L)
        assertEquals(DEFAULT_RANGE_DAYS, span)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordDriveAnalyticsSectionOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DriveAnalyticsSection"), fields)
    }

    // ── Aria fallback (catalog-absent keys -> web English default) ────────────────────

    @Test
    fun resolveOptionalReturnsLookupWhenPresentElseFallback() {
        val present = resolveOptional({ "Localized" }, KEY_SPEED_DISTRIBUTION_ARIA, DriveAnalyticsSectionDefaults.SPEED_DISTRIBUTION_ARIA)
        val absent = resolveOptional({ null }, KEY_ACCEL_PATTERNS_ARIA, DriveAnalyticsSectionDefaults.ACCEL_PATTERNS_ARIA)
        val blank = resolveOptional({ "  " }, KEY_POWER_PROFILE_ARIA, DriveAnalyticsSectionDefaults.POWER_PROFILE_ARIA)

        assertEquals("Localized", present)
        assertEquals("Per-drive scatter chart of peak power versus trip distance", absent)
        assertEquals("Recent-drives peak and regen power dual-area chart", blank)
    }

    private fun drive(
        startTs: String? = "2026-04-10T08:00:00Z",
        distanceM: Double = 10_000.0,
        avgSpeedMps: Double? = 20.0,
        avgPowerW: Double? = 20_000.0,
    ): DriveAnalyticsDrive = DriveAnalyticsDrive(startTs = startTs, distanceM = distanceM, avgSpeedMps = avgSpeedMps, avgPowerW = avgPowerW)

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
        private const val EM_DASH_TEST = "\u2014"
    }
}
