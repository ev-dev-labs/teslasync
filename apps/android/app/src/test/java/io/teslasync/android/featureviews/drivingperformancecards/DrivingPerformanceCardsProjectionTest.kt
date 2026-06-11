package io.teslasync.android.featureviews.drivingperformancecards

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DrivingPerformanceCards pure projection — the native port of the web
 * component's `({ data })` render contract
 * (web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx): the (snapshot, isLoading)
 * lifecycle adapter, the ordered six-tile value list with the web `fromKmh` / `fromKm` conversions, `safe()`
 * guard, and `fmtNumber` formatting (speed/power 0 dp, distance 1 dp), the per-card em dash for an absent
 * stat group, the per-unit subtitle, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate; no Compose, no device.
 */
class DrivingPerformanceCardsProjectionTest {
    private val metricPrefs =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = 2,
        )

    private val imperialPrefs = metricPrefs.copy(distance = DistanceUnitPref.MI, speed = SpeedUnitPref.MPH)

    private val fullSnapshot =
        DrivingPerformanceSnapshot(
            speedStats = DriveStatSummary(avg = 64.4, max = 113.0),
            powerStats = DriveStatSummary(avg = 42.0, max = 211.0),
            regenStats = DriveStatSummary(avg = 21.0, max = 67.0),
            distanceStats = DriveStatSummary(avg = 23.7, max = 142.3),
        )

    private fun valuesByMetric(
        snapshot: DrivingPerformanceSnapshot,
        prefs: UnitPref,
    ): Map<DrivingMetric, DrivingMetricValue> = DrivingPerformanceCardsProjection.metricValues(snapshot, prefs).associateBy { it.metric }

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

    // ── (snapshot, isLoading) → lifecycle UiState adapter ───────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithSnapshot() {
        val state = DrivingPerformanceCardsProjection.projectUiState(fullSnapshot, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenSnapshotPresentAndNotLoading() {
        val state = DrivingPerformanceCardsProjection.projectUiState(fullSnapshot, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(fullSnapshot, state.data)
    }

    @Test
    fun emptyWhenNoSnapshotAndNotLoading() {
        val state = DrivingPerformanceCardsProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun loadingWhenNoSnapshotAndLoading() {
        val state = DrivingPerformanceCardsProjection.projectUiState(snapshot = null, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
    }

    // ── metricValues: order (web's six MetricCards) ─────────────────────────────────────────────────────

    @Test
    fun metricValuesAreInWebSourceOrder() {
        val order = DrivingPerformanceCardsProjection.metricValues(fullSnapshot, metricPrefs).map { it.metric }
        assertEquals(
            listOf(
                DrivingMetric.TopSpeed,
                DrivingMetric.AvgSpeed,
                DrivingMetric.PeakPower,
                DrivingMetric.PeakRegen,
                DrivingMetric.AvgDriveDistance,
                DrivingMetric.LongestDrive,
            ),
            order,
        )
    }

    // ── metricValues: metric-unit conversions + formatting (web fromKmh / fromKm + fmtNumber) ───────────

    @Test
    fun metricUnitsConvertAndFormatEachTile() {
        val byMetric = valuesByMetric(fullSnapshot, metricPrefs)
        // Speed: backend km/h round-trips to km/h, 0 decimals (web fmtNumber(_, 0)).
        assertEquals("113", byMetric[DrivingMetric.TopSpeed]?.value)
        assertEquals("64", byMetric[DrivingMetric.AvgSpeed]?.value)
        // Power / regen: raw kW, 0 decimals.
        assertEquals("211", byMetric[DrivingMetric.PeakPower]?.value)
        assertEquals("67", byMetric[DrivingMetric.PeakRegen]?.value)
        // Distance: backend km round-trips to km, 1 decimal (web fmtNumber(_, 1)).
        assertEquals("23.7", byMetric[DrivingMetric.AvgDriveDistance]?.value)
        assertEquals("142.3", byMetric[DrivingMetric.LongestDrive]?.value)
    }

    @Test
    fun metricSubtitlesAreTheDisplayUnitLabels() {
        val byMetric = valuesByMetric(fullSnapshot, metricPrefs)
        assertEquals("km/h", byMetric[DrivingMetric.TopSpeed]?.subtitle)
        assertEquals("km/h", byMetric[DrivingMetric.AvgSpeed]?.subtitle)
        assertEquals("kW", byMetric[DrivingMetric.PeakPower]?.subtitle)
        assertEquals("kW", byMetric[DrivingMetric.PeakRegen]?.subtitle)
        assertEquals("km", byMetric[DrivingMetric.AvgDriveDistance]?.subtitle)
        assertEquals("km", byMetric[DrivingMetric.LongestDrive]?.subtitle)
    }

    // ── metricValues: imperial conversions (web useUnits mi / mph) ──────────────────────────────────────

    @Test
    fun imperialUnitsConvertSpeedAndDistance() {
        val byMetric = valuesByMetric(fullSnapshot, imperialPrefs)
        // 113 km/h ≈ 70 mph; 23.7 km ≈ 14.7 mi; 142.3 km ≈ 88.4 mi.
        assertEquals("70", byMetric[DrivingMetric.TopSpeed]?.value)
        assertEquals("mph", byMetric[DrivingMetric.TopSpeed]?.subtitle)
        assertEquals("14.7", byMetric[DrivingMetric.AvgDriveDistance]?.value)
        assertEquals("mi", byMetric[DrivingMetric.AvgDriveDistance]?.subtitle)
        assertEquals("88.4", byMetric[DrivingMetric.LongestDrive]?.value)
        assertEquals("mi", byMetric[DrivingMetric.LongestDrive]?.subtitle)
        // Power is never converted — still raw kW.
        assertEquals("211", byMetric[DrivingMetric.PeakPower]?.value)
        assertEquals("kW", byMetric[DrivingMetric.PeakPower]?.subtitle)
    }

    // ── metricValues: absent stat group → em dash, present-but-null field → 0 (web safe()) ──────────────

    @Test
    fun absentStatGroupsRenderEmDashWithUnitSubtitle() {
        val empty = DrivingPerformanceSnapshot(null, null, null, null)
        val byMetric = valuesByMetric(empty, metricPrefs)
        DrivingMetric.entries.forEach { metric ->
            assertEquals("\u2014", byMetric[metric]?.value)
        }
        // The unit subtitle is still shown for an em-dash tile (web subtitle={speedUnit} regardless).
        assertEquals("km/h", byMetric[DrivingMetric.TopSpeed]?.subtitle)
        assertEquals("kW", byMetric[DrivingMetric.PeakPower]?.subtitle)
        assertEquals("km", byMetric[DrivingMetric.LongestDrive]?.subtitle)
    }

    @Test
    fun presentGroupWithNullFieldsFormatsZero() {
        // Web parity: `ss ? fmtNumber(fromKmh(safe(ss.max)), 0) : '—'` — a present group with null fields
        // is `safe()`-guarded to 0, NOT an em dash.
        val snapshot =
            DrivingPerformanceSnapshot(
                speedStats = DriveStatSummary(avg = null, max = null),
                powerStats = DriveStatSummary(avg = null, max = null),
                regenStats = null,
                distanceStats = DriveStatSummary(avg = null, max = null),
            )
        val byMetric = valuesByMetric(snapshot, metricPrefs)
        assertEquals("0", byMetric[DrivingMetric.TopSpeed]?.value)
        assertEquals("0", byMetric[DrivingMetric.AvgSpeed]?.value)
        assertEquals("0", byMetric[DrivingMetric.PeakPower]?.value)
        assertEquals("0.0", byMetric[DrivingMetric.AvgDriveDistance]?.value)
        assertEquals("0.0", byMetric[DrivingMetric.LongestDrive]?.value)
        // The absent regen group is still an em dash.
        assertEquals("\u2014", byMetric[DrivingMetric.PeakRegen]?.value)
    }

    @Test
    fun nonFiniteValuesAreGuardedToZero() {
        // Web `safe()` maps NaN / Infinity to 0 before conversion.
        val snapshot =
            DrivingPerformanceSnapshot(
                speedStats = DriveStatSummary(avg = Double.NaN, max = Double.POSITIVE_INFINITY),
                powerStats = null,
                regenStats = null,
                distanceStats = null,
            )
        val byMetric = valuesByMetric(snapshot, metricPrefs)
        assertEquals("0", byMetric[DrivingMetric.TopSpeed]?.value)
        assertEquals("0", byMetric[DrivingMetric.AvgSpeed]?.value)
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordDrivingPerformanceCardsOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "DrivingPerformanceCards"), opened.single().second)
        assertEquals("DrivingPerformanceCards", DRIVING_PERFORMANCE_CARDS_SLUG)
    }
}
