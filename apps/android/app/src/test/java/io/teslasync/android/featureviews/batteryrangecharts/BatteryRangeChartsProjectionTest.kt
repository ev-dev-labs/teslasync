package io.teslasync.android.featureviews.batteryrangecharts

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the Battery & Range charts' pure logic — the native analogue of the web
 * surface's two `useMemo` derivations (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts
 * .tsx): the Current/Remaining battery-bar split with its 0-100 clamp, the per-drive trend mapping
 * (`formatDate` / rounded `convertDistanceFromSI` / rounded minutes) with its `.reverse()` ordering and the
 * `length > 0` empty guard, the `batteryColor` band thresholds, the tolerant `formatDate` helper, the
 * locale-grouped `fmtInt`, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class BatteryRangeChartsProjectionTest {
    private val utc = ZoneId.of("UTC")

    // ── batteryBars (web batteryChartData: [{ Current, level }, { Remaining, 100 - level }]) ──────

    @Test
    fun batteryBarsSplitsTheLevelIntoCurrentAndRemaining() {
        val bars = BatteryRangeChartsProjection.batteryBars(72.0)

        assertEquals(listOf(BatterySegment.Current, BatterySegment.Remaining), bars.map { it.segment })
        assertEquals(72.0, bars[0].value, 0.0)
        assertEquals(28.0, bars[1].value, 0.0)
    }

    @Test
    fun batteryBarsClampAnOutOfRangeLevelSoRemainingIsNeverNegative() {
        // Above 100 → full current, zero remaining (web YAxis domain [0,100]).
        val high = BatteryRangeChartsProjection.batteryBars(120.0)
        assertEquals(100.0, high[0].value, 0.0)
        assertEquals(0.0, high[1].value, 0.0)

        // Below 0 → empty current, full remaining.
        val low = BatteryRangeChartsProjection.batteryBars(-5.0)
        assertEquals(0.0, low[0].value, 0.0)
        assertEquals(100.0, low[1].value, 0.0)
    }

    @Test
    fun batteryBarsCoerceANonFiniteLevelToZero() {
        val bars = BatteryRangeChartsProjection.batteryBars(Double.NaN)

        assertEquals(0.0, bars[0].value, 0.0)
        assertEquals(100.0, bars[1].value, 0.0)
    }

    // ── driveTrend (web driveChartData map + reverse + length>0 guard) ────────────────────────────

    @Test
    fun driveTrendMapsRoundsAndReversesPreservingTheWebOrder() {
        val drives =
            listOf(
                // The feed arrives newest-first; the web `.reverse()` plots oldest→newest left-to-right.
                DriveSample(startTs = "2026-03-18T08:00:00Z", distanceMeters = 42_400.0, durationSeconds = 2_730.0),
                DriveSample(startTs = "2026-03-16T18:15:00Z", distanceMeters = 18_500.0, durationSeconds = 1_500.0),
            )

        val result =
            BatteryRangeChartsProjection.driveTrend(
                drives = drives,
                convertDistance = { meters -> meters / 1_000.0 }, // SI metres → km (deterministic)
                formatDate = { raw -> raw.substring(0, 10) }, // YYYY-MM-DD (deterministic)
            )

        assertFalse(result.isEmpty)
        // Reversed: oldest (03-16) first.
        assertEquals(listOf("2026-03-16", "2026-03-18"), result.xLabels)
        // distance: round(18500/1000)=19, round(42400/1000)=42 (web Math.round).
        assertEquals(listOf(19.0, 42.0), result.distanceValues)
        // duration: round(1500/60)=25, round(2730/60)=46 (web Math.round(d.duration_s / 60)).
        assertEquals(listOf(25.0, 46.0), result.durationValues)
        assertEquals(2, result.points.size)
        assertEquals("2026-03-16", result.points.first().date)
    }

    @Test
    fun driveTrendRoundsHalfUpLikeWebMathRound() {
        val drives = listOf(DriveSample(startTs = "2026-01-01T00:00:00Z", distanceMeters = 2_500.0, durationSeconds = 150.0))

        val result =
            BatteryRangeChartsProjection.driveTrend(
                drives = drives,
                convertDistance = { it / 1_000.0 }, // 2.5 km → rounds to 3 (half up)
                formatDate = { it },
            )

        assertEquals(3.0, result.distanceValues.single(), 0.0) // Math.round(2.5) == 3
        assertEquals(3.0, result.durationValues.single(), 0.0) // Math.round(150/60=2.5) == 3
    }

    @Test
    fun driveTrendIsEmptyForNoDrives() {
        val result =
            BatteryRangeChartsProjection.driveTrend(
                drives = emptyList(),
                convertDistance = { it },
                formatDate = { it },
            )

        assertTrue(result.isEmpty)
        assertTrue(result.points.isEmpty())
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.distanceValues.isEmpty())
        assertTrue(result.durationValues.isEmpty())
    }

    @Test
    fun driveTrendCoercesNonFiniteDistanceToZero() {
        val drives = listOf(DriveSample(startTs = "2026-01-01T00:00:00Z", distanceMeters = Double.NaN, durationSeconds = 60.0))

        val result =
            BatteryRangeChartsProjection.driveTrend(
                drives = drives,
                convertDistance = { it }, // NaN passes through; the projection's safe-round coerces to 0
                formatDate = { it },
            )

        assertEquals(0.0, result.distanceValues.single(), 0.0)
        assertEquals(1.0, result.durationValues.single(), 0.0)
    }

    // ── BatteryBand (web batteryColor: >60 good, >25 warn, else critical) ─────────────────────────

    @Test
    fun batteryBandClassifiesWithStrictlyGreaterThanThresholds() {
        assertEquals(BatteryBand.Good, BatteryBand.fromLevel(61.0))
        assertEquals(BatteryBand.Good, BatteryBand.fromLevel(100.0))
        // The exact thresholds land in the LOWER band (web exclusive `>`).
        assertEquals(BatteryBand.Warning, BatteryBand.fromLevel(60.0))
        assertEquals(BatteryBand.Warning, BatteryBand.fromLevel(26.0))
        assertEquals(BatteryBand.Critical, BatteryBand.fromLevel(25.0))
        assertEquals(BatteryBand.Critical, BatteryBand.fromLevel(0.0))
    }

    // ── fmtInt (web fmtInt parity) ────────────────────────────────────────────────────────────────

    @Test
    fun fmtIntGroupsThousandsAndRoundsHalfUp() {
        assertEquals("0", BatteryRangeChartsProjection.fmtInt(0.0, Locale.US))
        assertEquals("1,204", BatteryRangeChartsProjection.fmtInt(1_204.0, Locale.US))
        assertEquals("3", BatteryRangeChartsProjection.fmtInt(2.5, Locale.US)) // Math.round(2.5)
    }

    // ── formatDate (web formatDate: medium date, em-dash on garbage) ──────────────────────────────

    @Test
    fun formatDateRendersAMediumDateForIsoAndDateOnlyInput() {
        assertEquals("Mar 18, 2026", BatteryRangeChartsFormat.formatDate("2026-03-18T08:00:00Z", Locale.US, utc))
        assertEquals("Mar 18, 2026", BatteryRangeChartsFormat.formatDate("2026-03-18", Locale.US, utc))
    }

    @Test
    fun formatDateFallsBackToEmDashForBlankOrUnparseableInput() {
        assertEquals(BATTERY_RANGE_EM_DASH, BatteryRangeChartsFormat.formatDate("", Locale.US, utc))
        assertEquals(BATTERY_RANGE_EM_DASH, BatteryRangeChartsFormat.formatDate("   ", Locale.US, utc))
        assertEquals(BATTERY_RANGE_EM_DASH, BatteryRangeChartsFormat.formatDate("not-a-date", Locale.US, utc))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordBatteryRangeChartsOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "BatteryRangeCharts"), fields)
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
}
