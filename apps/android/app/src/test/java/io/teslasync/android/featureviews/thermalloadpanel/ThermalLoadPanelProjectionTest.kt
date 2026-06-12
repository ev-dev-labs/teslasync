package io.teslasync.android.featureviews.thermalloadpanel

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
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the ThermalLoadPanel pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx): the per-sensor
 * `value ?? 0` bar value, the `tempSeverityColor` bucketing, the `displayTemp(value, formatTemperature)` readout,
 * and the four InlineMetrics with their `> 0` / `stats ? … : '—'` gates and `fmtInt` / `fmtNumber(…, 1)`
 * formatting. Because the surface is presentational, each [ThermalLoadDisplay] is exactly what the thin
 * composable renders, so these assertions double as the per-state adapter "snapshot".
 */
class ThermalLoadPanelProjectionTest {
    private fun prefs(
        temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
        precision: Int? = null,
    ): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = precision,
        )

    private fun inputs(
        sensors: List<ThermalSensor> = emptyList(),
        peakPowerW: Double? = null,
        avgPowerW: Double? = null,
        stats: DrivingStatsSummary? = null,
    ): ThermalLoadInputs = ThermalLoadInputs(sensors, peakPowerW, avgPowerW, stats)

    private fun project(
        inputs: ThermalLoadInputs = inputs(),
        loading: Boolean = false,
        prefs: UnitPref = prefs(),
    ): ThermalLoadDisplay = ThermalLoadPanelProjection.project(inputs, loading, prefs, Locale.US)

    private fun metric(
        display: ThermalLoadDisplay,
        kind: ThermalMetricKind,
    ): String = display.metrics.first { it.kind == kind }.value

    // ── barValue(): web `value ?? 0`, hardened against NaN/Infinite ──────────────

    @Test
    fun barValueReturnsFiniteValuesUnchanged() {
        assertEquals(78.0, ThermalLoadPanelProjection.barValue(78.0), 0.0)
        assertEquals(0.0, ThermalLoadPanelProjection.barValue(0.0), 0.0)
        assertEquals(-12.5, ThermalLoadPanelProjection.barValue(-12.5), 0.0)
    }

    @Test
    fun barValueCoercesNullAndNonFiniteToZero() {
        assertEquals(0.0, ThermalLoadPanelProjection.barValue(null), 0.0)
        assertEquals(0.0, ThermalLoadPanelProjection.barValue(Double.NaN), 0.0)
        assertEquals(0.0, ThermalLoadPanelProjection.barValue(Double.POSITIVE_INFINITY), 0.0)
        assertEquals(0.0, ThermalLoadPanelProjection.barValue(Double.NEGATIVE_INFINITY), 0.0)
    }

    // ── severityOf(): web `tempSeverityColor` ratio bucketing ────────────────────

    @Test
    fun severityNullReadingIsUnknown() {
        assertEquals(ThermalSeverity.Unknown, ThermalLoadPanelProjection.severityOf(null, 150.0))
    }

    @Test
    fun severityNonPositiveCeilingIsUnknown() {
        assertEquals(ThermalSeverity.Unknown, ThermalLoadPanelProjection.severityOf(50.0, 0.0))
        assertEquals(ThermalSeverity.Unknown, ThermalLoadPanelProjection.severityOf(50.0, -10.0))
    }

    @Test
    fun severityBucketsByRatio() {
        // 0.52 ratio -> good, 0.693 -> warning (>= 0.65), 0.90 -> critical (>= 0.85).
        assertEquals(ThermalSeverity.Good, ThermalLoadPanelProjection.severityOf(78.0, 150.0))
        assertEquals(ThermalSeverity.Warning, ThermalLoadPanelProjection.severityOf(104.0, 150.0))
        assertEquals(ThermalSeverity.Critical, ThermalLoadPanelProjection.severityOf(108.0, 120.0))
    }

    @Test
    fun severityBoundariesAreInclusive() {
        // Exactly 0.65 -> warning; exactly 0.85 -> critical; just below 0.65 -> good.
        assertEquals(ThermalSeverity.Warning, ThermalLoadPanelProjection.severityOf(65.0, 100.0))
        assertEquals(ThermalSeverity.Critical, ThermalLoadPanelProjection.severityOf(85.0, 100.0))
        assertEquals(ThermalSeverity.Good, ThermalLoadPanelProjection.severityOf(64.0, 100.0))
    }

    // ── formatGrouped(): web `fmtNumber(value, digits)` ──────────────────────────

    @Test
    fun formatGroupedZeroDigitsRoundsToWholeNumber() {
        assertEquals("247", ThermalLoadPanelProjection.formatGrouped(247.0, 0, Locale.US))
        assertEquals("1", ThermalLoadPanelProjection.formatGrouped(0.5, 0, Locale.US))
    }

    @Test
    fun formatGroupedOneDigitShowsExactlyOneFractionDigit() {
        assertEquals("118.5", ThermalLoadPanelProjection.formatGrouped(118.5, 1, Locale.US))
        assertEquals("0.0", ThermalLoadPanelProjection.formatGrouped(0.0, 1, Locale.US))
    }

    @Test
    fun formatGroupedRoundsHalfAwayFromZero() {
        assertEquals("1.3", ThermalLoadPanelProjection.formatGrouped(1.25, 1, Locale.US))
    }

    @Test
    fun formatGroupedGroupsThousands() {
        assertEquals("1,284", ThermalLoadPanelProjection.formatGrouped(1284.0, 0, Locale.US))
    }

    @Test
    fun formatGroupedNormalizesNegativeZero() {
        assertEquals("0", ThermalLoadPanelProjection.formatGrouped(-0.0, 0, Locale.US))
        assertEquals("0.0", ThermalLoadPanelProjection.formatGrouped(-0.0, 1, Locale.US))
    }

    // ── project(): bars ──────────────────────────────────────────────────────────

    @Test
    fun projectBuildsOneBarPerSensorWithSeverityAndReadout() {
        val display =
            project(
                inputs(
                    sensors =
                        listOf(
                            ThermalSensor("frontMotor", "Front Motor", 78.0, 150.0),
                            ThermalSensor("inverter", "Inverter", 108.0, 120.0),
                        ),
                ),
            )

        assertEquals(2, display.bars.size)
        val front = display.bars[0]
        assertEquals("frontMotor", front.key)
        assertEquals("Front Motor", front.label)
        assertEquals(78.0, front.value, 0.0)
        assertEquals(150.0, front.maxTemp, 0.0)
        assertEquals(ThermalSeverity.Good, front.severity)
        assertEquals("78.0\u00B0C", front.readout)

        val inverter = display.bars[1]
        assertEquals(ThermalSeverity.Critical, inverter.severity)
        assertEquals("108.0\u00B0C", inverter.readout)
    }

    @Test
    fun projectAbsentSensorReadingCoercesValueToZeroAndReadsEmDash() {
        val display = project(inputs(sensors = listOf(ThermalSensor("battery", "Battery", null, 60.0))))

        val bar = display.bars.single()
        assertEquals(0.0, bar.value, 0.0)
        assertEquals(ThermalSeverity.Unknown, bar.severity)
        assertEquals(EM_DASH, bar.readout)
    }

    @Test
    fun projectFahrenheitReadoutConvertsFromSi() {
        val display =
            project(
                inputs(sensors = listOf(ThermalSensor("frontMotor", "Front Motor", 100.0, 150.0))),
                prefs = prefs(temperature = TemperatureUnitPref.FAHRENHEIT),
            )

        // 100 deg C -> 212 deg F.
        assertEquals("212.0\u00B0F", display.bars.single().readout)
    }

    @Test
    fun projectReadoutHonorsPrecisionPreference() {
        val display =
            project(
                inputs(sensors = listOf(ThermalSensor("frontMotor", "Front Motor", 78.0, 150.0))),
                prefs = prefs(precision = 2),
            )

        assertEquals("78.00\u00B0C", display.bars.single().readout)
    }

    // ── project(): power metrics ─────────────────────────────────────────────────

    @Test
    fun projectPeakPowerConvertsWattsToKilowattsAsWholeNumber() {
        val display = project(inputs(peakPowerW = 247_000.0))
        assertEquals("247 kW", metric(display, ThermalMetricKind.PeakPower))
    }

    @Test
    fun projectAvgPowerConvertsWattsToKilowattsWithOneDigit() {
        val display = project(inputs(avgPowerW = 118_500.0))
        assertEquals("118.5 kW", metric(display, ThermalMetricKind.AvgPower))
    }

    @Test
    fun projectNonPositiveOrMissingPowerReadsEmDash() {
        val zero = project(inputs(peakPowerW = 0.0, avgPowerW = -1.0))
        assertEquals(EM_DASH, metric(zero, ThermalMetricKind.PeakPower))
        assertEquals(EM_DASH, metric(zero, ThermalMetricKind.AvgPower))

        val missing = project(inputs(peakPowerW = null, avgPowerW = Double.NaN))
        assertEquals(EM_DASH, metric(missing, ThermalMetricKind.PeakPower))
        assertEquals(EM_DASH, metric(missing, ThermalMetricKind.AvgPower))
    }

    // ── project(): stats metrics ─────────────────────────────────────────────────

    @Test
    fun projectStatsRenderDriveCountAndRegenRatio() {
        val display = project(inputs(stats = DrivingStatsSummary(totalDrives = 1284, regenRatio = 0.187)))
        assertEquals("1,284", metric(display, ThermalMetricKind.Drives))
        assertEquals("18.7%", metric(display, ThermalMetricKind.RegenRatio))
    }

    @Test
    fun projectZeroStatsStillRenderRatherThanEmDash() {
        // Web gate is `stats ? … : '—'` — a present summary with zero values still renders.
        val display = project(inputs(stats = DrivingStatsSummary(totalDrives = 0, regenRatio = 0.0)))
        assertEquals("0", metric(display, ThermalMetricKind.Drives))
        assertEquals("0.0%", metric(display, ThermalMetricKind.RegenRatio))
    }

    @Test
    fun projectMissingStatsReadEmDash() {
        val display = project(inputs(stats = null))
        assertEquals(EM_DASH, metric(display, ThermalMetricKind.Drives))
        assertEquals(EM_DASH, metric(display, ThermalMetricKind.RegenRatio))
    }

    @Test
    fun projectAlwaysEmitsFourMetricsInWebOrder() {
        val display = project()
        assertEquals(
            listOf(
                ThermalMetricKind.PeakPower,
                ThermalMetricKind.AvgPower,
                ThermalMetricKind.Drives,
                ThermalMetricKind.RegenRatio,
            ),
            display.metrics.map { it.kind },
        )
    }

    // ── project(): hasContent + loading ──────────────────────────────────────────

    @Test
    fun projectNoSensorsNoStatsNoPowerHasNoContent() {
        val display = project()
        assertFalse(display.hasContent)
        assertTrue(display.bars.isEmpty())
    }

    @Test
    fun projectStatsAloneCountsAsContent() {
        val display = project(inputs(stats = DrivingStatsSummary(totalDrives = 5, regenRatio = 0.1)))
        assertTrue(display.hasContent)
        assertTrue(display.bars.isEmpty())
    }

    @Test
    fun projectSensorsAloneCountAsContent() {
        val display = project(inputs(sensors = listOf(ThermalSensor("battery", "Battery", null, 60.0))))
        assertTrue(display.hasContent)
    }

    @Test
    fun projectThreadsLoadingFlag() {
        assertTrue(project(loading = true).loading)
        assertFalse(project(loading = false).loading)
    }

    // ── resolveDisplayLocale(): web `fmtNumber` locale default ───────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
    }

    @Test
    fun resolveDisplayLocaleParsesBcp47Tag() {
        assertEquals(Locale.US, resolveDisplayLocale("en-US"))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }
}
