package io.teslasync.android.featureviews.motorefficiencyinsights

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the MotorEfficiencyInsights pure projection — the native mirror of every
 * derivation the web component performs
 * (web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx): the (snapshot,
 * isLoading) lifecycle adapter, the per-panel `motorStats ? … : noData` presence test, the
 * `fmtNumber(value, 1)` + fixed-unit readouts, the `convertTempFromSI` display conversion, the raw-Celsius
 * thermal verdict, and the `throttleStyle ?? Aggressive` fall-through. Runs in the
 * :android:testReleaseUnitTest gate; no Compose, no device. Because the surface is presentational, each
 * [MotorEfficiencyDisplay] is exactly what the thin composable renders, so these assertions double as the
 * per-state adapter snapshot.
 */
class MotorEfficiencyInsightsProjectionTest {
    private val celsiusPrefs =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            // A non-1 default precision must NOT leak in: the web pins each readout to fmtNumber(_, 1).
            precision = 3,
        )

    private val fahrenheitPrefs = celsiusPrefs.copy(temperature = TemperatureUnitPref.FAHRENHEIT)

    private val sampleStats =
        MotorStats(
            avgTorque = 215.4,
            maxTorque = 342.0,
            highTorquePct = 12.5,
            avgPower = 42.0,
            avgMotorTemp = 48.6,
            maxMotorTemp = 72.3,
        )

    private fun snapshot(
        stats: MotorStats? = sampleStats,
        style: ThrottleStyle? = ThrottleStyle.Moderate,
    ) = MotorEfficiencySnapshot(motorStats = stats, throttleStyle = style)

    // ── (snapshot, isLoading) → lifecycle UiState adapter ───────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithMotorStats() {
        val state = MotorEfficiencyInsightsProjection.projectUiState(snapshot(), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenMotorStatsPresentAndNotLoading() {
        val state = MotorEfficiencyInsightsProjection.projectUiState(snapshot(), isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snapshot(), state.data)
    }

    @Test
    fun emptyWhenMotorStatsAbsentAndNotLoading() {
        val state = MotorEfficiencyInsightsProjection.projectUiState(snapshot(stats = null), isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun emptyWhenSnapshotNullAndNotLoading() {
        val state = MotorEfficiencyInsightsProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun loadingWhenSnapshotNullAndLoading() {
        val state = MotorEfficiencyInsightsProjection.projectUiState(snapshot = null, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
    }

    // ── project(): content — torque / throttle / thermal readouts (web fmtNumber + unit suffix) ─────────

    @Test
    fun projectFormatsTorquePanelWithUnitSuffixes() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(), celsiusPrefs)
        assertTrue(display.hasData)
        val torque = requireNotNull(display.torque)
        // Web: `{fmtNumber(_, 1)} Nm` and `{fmtNumber(_, 1)}%` — one decimal, even with prefs.precision = 3.
        assertEquals("215.4 Nm", torque.avgTorque)
        assertEquals("342.0 Nm", torque.maxTorque)
        assertEquals("12.5%", torque.highTorqueTime)
    }

    @Test
    fun projectFormatsThrottlePanelPowerStyleAndBar() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(), celsiusPrefs)
        val throttle = requireNotNull(display.throttle)
        assertEquals("42.0 kW", throttle.avgPower)
        assertEquals(ThrottleStyle.Moderate, throttle.style)
        // Web MetricBar value={motorStats.avgPower} max={200} — raw kW, no conversion.
        assertEquals(42.0, throttle.powerBarValue, 0.0)
        assertEquals(200.0, throttle.powerBarMax, 0.0)
    }

    @Test
    fun projectFormatsThermalPanelInCelsiusWithGoodVerdict() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(), celsiusPrefs)
        val thermal = requireNotNull(display.thermal)
        assertEquals("48.6\u00B0C", thermal.avgMotorTemp)
        assertEquals("72.3\u00B0C", thermal.maxMotorTemp)
        // maxMotorTemp 72.3 °C < 100 → Good.
        assertEquals(ThermalStatus.Good, thermal.status)
    }

    @Test
    fun projectConvertsThermalToFahrenheit() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(), fahrenheitPrefs)
        val thermal = requireNotNull(display.thermal)
        // 48.6 °C → 119.48 °F → "119.5"; 72.3 °C → 162.14 °F → "162.1".
        assertEquals("119.5\u00B0F", thermal.avgMotorTemp)
        assertEquals("162.1\u00B0F", thermal.maxMotorTemp)
        // The thermal verdict reads the RAW SI Celsius (72.3 < 100), never the converted Fahrenheit value.
        assertEquals(ThermalStatus.Good, thermal.status)
    }

    @Test
    fun projectGroupsThousandsLikeToLocaleString() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(stats = sampleStats.copy(maxTorque = 1234.5)), celsiusPrefs)
        assertEquals("1,234.5 Nm", requireNotNull(display.torque).maxTorque)
    }

    // ── project(): throttle style fall-through (web `: 'Aggressive'` / `: danger`) ───────────────────────

    @Test
    fun projectTreatsNullThrottleStyleAsAggressive() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(style = null), celsiusPrefs)
        assertEquals(ThrottleStyle.Aggressive, requireNotNull(display.throttle).style)
    }

    @Test
    fun projectPreservesExplicitThrottleStyle() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(style = ThrottleStyle.Conservative), celsiusPrefs)
        assertEquals(ThrottleStyle.Conservative, requireNotNull(display.throttle).style)
    }

    // ── project(): empty (web per-panel noData) ──────────────────────────────────────────────────────────

    @Test
    fun projectNullMotorStatsHasNoDataAndNullPanels() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot(stats = null), celsiusPrefs)
        assertFalse(display.hasData)
        assertNull(display.torque)
        assertNull(display.throttle)
        assertNull(display.thermal)
    }

    @Test
    fun projectNullSnapshotHasNoData() {
        val display = MotorEfficiencyInsightsProjection.project(snapshot = null, prefs = celsiusPrefs)
        assertFalse(display.hasData)
        assertNull(display.torque)
    }

    @Test
    fun projectGuardsNonFiniteReadingsToZero() {
        val stats =
            sampleStats.copy(
                avgTorque = Double.NaN,
                avgPower = Double.POSITIVE_INFINITY,
                avgMotorTemp = Double.NaN,
            )
        val display = MotorEfficiencyInsightsProjection.project(snapshot(stats = stats), celsiusPrefs)
        assertEquals("0.0 Nm", requireNotNull(display.torque).avgTorque)
        assertEquals("0.0 kW", requireNotNull(display.throttle).avgPower)
        assertEquals(0.0, requireNotNull(display.throttle).powerBarValue, 0.0)
        // convertTempFromSI(NaN) is non-finite, coerced to 0 by `number` AFTER conversion (web fmtNumber order).
        assertEquals("0.0\u00B0C", requireNotNull(display.thermal).avgMotorTemp)
    }

    // ── thermalStatus(): web `< 100 ? Good : < 140 ? Warm : Hot` (raw SI °C) ─────────────────────────────

    @Test
    fun thermalStatusBelowGoodCeilingIsGood() {
        assertEquals(ThermalStatus.Good, MotorEfficiencyInsightsProjection.thermalStatus(99.9))
        assertEquals(ThermalStatus.Good, MotorEfficiencyInsightsProjection.thermalStatus(0.0))
    }

    @Test
    fun thermalStatusAtGoodCeilingIsWarm() {
        // 100 is NOT < 100 → Warm (the boundary belongs to the next band, matching `<`).
        assertEquals(ThermalStatus.Warm, MotorEfficiencyInsightsProjection.thermalStatus(100.0))
        assertEquals(ThermalStatus.Warm, MotorEfficiencyInsightsProjection.thermalStatus(139.9))
    }

    @Test
    fun thermalStatusAtWarmCeilingIsHot() {
        assertEquals(ThermalStatus.Hot, MotorEfficiencyInsightsProjection.thermalStatus(140.0))
        assertEquals(ThermalStatus.Hot, MotorEfficiencyInsightsProjection.thermalStatus(180.0))
    }

    @Test
    fun thermalStatusNonFiniteFallsThroughToHot() {
        // Web `NaN < n` is false for both comparisons → terminal Hot branch.
        assertEquals(ThermalStatus.Hot, MotorEfficiencyInsightsProjection.thermalStatus(Double.NaN))
    }

    // ── accent levels (badge variant + bar color identity) ───────────────────────────────────────────────

    @Test
    fun throttleStyleAccentLevels() {
        assertEquals(MotorAccentLevel.Good, ThrottleStyle.Conservative.level)
        assertEquals(MotorAccentLevel.Caution, ThrottleStyle.Moderate.level)
        assertEquals(MotorAccentLevel.Alert, ThrottleStyle.Aggressive.level)
    }

    @Test
    fun thermalStatusAccentLevels() {
        assertEquals(MotorAccentLevel.Good, ThermalStatus.Good.level)
        assertEquals(MotorAccentLevel.Caution, ThermalStatus.Warm.level)
        assertEquals(MotorAccentLevel.Alert, ThermalStatus.Hot.level)
    }

    // ── number(): web `fmtNumber(value, 1)` ──────────────────────────────────────────────────────────────

    @Test
    fun numberAlwaysShowsOneFractionDigit() {
        assertEquals("21.0", MotorEfficiencyInsightsProjection.number(21.0, Locale.US))
        assertEquals("9.1", MotorEfficiencyInsightsProjection.number(9.1, Locale.US))
    }

    @Test
    fun numberRoundsHalfAwayFromZero() {
        assertEquals("18.3", MotorEfficiencyInsightsProjection.number(18.25, Locale.US))
        assertEquals("-2.3", MotorEfficiencyInsightsProjection.number(-2.25, Locale.US))
    }

    @Test
    fun numberNormalizesNegativeZero() {
        assertEquals("0.0", MotorEfficiencyInsightsProjection.number(-0.0, Locale.US))
    }

    @Test
    fun numberCoercesNonFiniteToZero() {
        assertEquals("0.0", MotorEfficiencyInsightsProjection.number(Double.NaN, Locale.US))
        assertEquals("0.0", MotorEfficiencyInsightsProjection.number(Double.POSITIVE_INFINITY, Locale.US))
    }

    // ── safe() + resolveDisplayLocale() ──────────────────────────────────────────────────────────────────

    @Test
    fun safeReturnsFiniteValuesAndZeroesTheRest() {
        assertEquals(42.0, MotorEfficiencyInsightsProjection.safe(42.0), 0.0)
        assertEquals(0.0, MotorEfficiencyInsightsProjection.safe(Double.NaN), 0.0)
        assertEquals(0.0, MotorEfficiencyInsightsProjection.safe(Double.NEGATIVE_INFINITY), 0.0)
    }

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }
}
