package io.teslasync.android.featureviews.speedgearpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SpeedGearPanel pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx): the SI
 * drive-speed aggregation with null coercion, the SINGLE m/s→display conversion at the render site (the
 * double-conversion regression the web test pins), the per-cell `… != null ? … : '—'` formatting, and the
 * `shiftColor` / `shiftBadgeVariant` ternaries. Because the surface is presentational, each
 * [SpeedGearDisplay] is exactly what the thin composable renders, so these assertions double as the per-state
 * adapter "snapshot".
 */
class SpeedGearPanelProjectionTest {
    private fun prefs(
        speed: SpeedUnitPref = SpeedUnitPref.MPH,
        precision: Int? = 2,
        locale: String? = "en-US",
    ): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.MI,
            speed = speed,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.PSI,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = locale,
            precision = precision,
        )

    private fun display(
        motor: MotorShift?,
        drives: List<DriveSpeedSample>,
        prefs: UnitPref = prefs(),
    ): SpeedGearDisplay = SpeedGearPanelProjection.display(SpeedGearSnapshot(motor, drives), prefs, resolveDisplayLocale(prefs.locale))

    private fun SpeedGearDisplay.value(metric: SpeedGearMetric): String = metrics.first { it.metric == metric }.value

    private fun SpeedGearDisplay.unit(metric: SpeedGearMetric): String = metrics.first { it.metric == metric }.unit

    // ── Drive-speed aggregation (SI m/s) ─────────────────────────────────────────

    @Test
    fun avgDriveSpeedMpsIsTheMeanOfPerDriveAverages() {
        val avg =
            SpeedGearPanelProjection.avgDriveSpeedMps(
                listOf(DriveSpeedSample(22.352, 44.704), DriveSpeedSample(13.4112, 31.2928)),
            )
        // (22.352 + 13.4112) / 2 = 17.8816 m/s.
        assertEquals(17.8816, avg!!, 1e-9)
    }

    @Test
    fun topDriveSpeedMpsIsTheLargestPerDriveMaximum() {
        val top =
            SpeedGearPanelProjection.topDriveSpeedMps(
                listOf(DriveSpeedSample(22.352, 44.704), DriveSpeedSample(13.4112, 31.2928)),
            )
        assertEquals(44.704, top!!, 1e-9)
    }

    @Test
    fun nullPerDriveSpeedsCoerceToZeroNotSkipped() {
        // Web `d.avgSpeedMps ?? 0` / `d.maxSpeedMps ?? 0`: a null-only drive contributes 0, pulling the mean
        // down, while the max ignores it because 0 < the real figure.
        val drives = listOf(DriveSpeedSample(44.704, 44.704), DriveSpeedSample(null, null))
        assertEquals(22.352, SpeedGearPanelProjection.avgDriveSpeedMps(drives)!!, 1e-9)
        assertEquals(44.704, SpeedGearPanelProjection.topDriveSpeedMps(drives)!!, 1e-9)
    }

    @Test
    fun emptyDrivesYieldNullAggregates() {
        assertNull(SpeedGearPanelProjection.avgDriveSpeedMps(emptyList()))
        assertNull(SpeedGearPanelProjection.topDriveSpeedMps(emptyList()))
    }

    // ── Single-conversion invariant (the web double-conversion regression) ───────

    @Test
    fun topDriveSpeedConvertsOnceToMph() {
        // 44.704 m/s = 100 mph exactly. The pre-fix double application produced "224"; the single conversion
        // pins "100".
        val d = display(motor = null, drives = listOf(DriveSpeedSample(22.352, 44.704)))
        assertEquals("100", d.value(SpeedGearMetric.TopDriveSpeed))
        assertEquals("mph", d.unit(SpeedGearMetric.TopDriveSpeed))
    }

    @Test
    fun avgDriveSpeedConvertsOnceToMph() {
        // Two drives at 22.352 and 13.4112 m/s → mean 17.8816 m/s = 40 mph (pre-fix would have shown ~"89").
        val d =
            display(
                motor = null,
                drives = listOf(DriveSpeedSample(22.352, 44.704), DriveSpeedSample(13.4112, 31.2928)),
            )
        assertEquals("40", d.value(SpeedGearMetric.AvgDriveSpeed))
    }

    @Test
    fun topDriveSpeedConvertsOnceToKmh() {
        // 27.7778 m/s = 100 km/h; pre-fix km/h users saw ×3.6² = ×12.96.
        val d =
            display(
                motor = null,
                drives = listOf(DriveSpeedSample(13.8889, 27.7778)),
                prefs = prefs(speed = SpeedUnitPref.KMH),
            )
        assertEquals("100", d.value(SpeedGearMetric.TopDriveSpeed))
        assertEquals("km/h", d.unit(SpeedGearMetric.TopDriveSpeed))
    }

    @Test
    fun nullOnlyDriveHalvesTheAverageButKeepsTheMax() {
        // Web-documented behaviour: one 100 mph drive + one null-only drive → top stays 100 mph, avg is
        // (44.704 + 0) / 2 = 22.352 m/s = 50 mph.
        val d =
            display(
                motor = null,
                drives = listOf(DriveSpeedSample(44.704, 44.704), DriveSpeedSample(null, null)),
            )
        assertEquals("100", d.value(SpeedGearMetric.TopDriveSpeed))
        assertEquals("50", d.value(SpeedGearMetric.AvgDriveSpeed))
    }

    @Test
    fun emptyDrivesRenderEmDashForBothSpeedsButKeepTheUnit() {
        val d = display(motor = MotorShift("D", 10.0), drives = emptyList())
        assertEquals(DASH, d.value(SpeedGearMetric.AvgDriveSpeed))
        assertEquals(DASH, d.value(SpeedGearMetric.TopDriveSpeed))
        // The unit is always shown beneath the value, even when the value is the em-dash (web parity).
        assertEquals("mph", d.unit(SpeedGearMetric.AvgDriveSpeed))
        assertEquals("mph", d.unit(SpeedGearMetric.TopDriveSpeed))
    }

    // ── Motor power (raw kW at the user's precision) ─────────────────────────────

    @Test
    fun powerRendersRawKwAtUserPrecision() {
        val d = display(motor = MotorShift("D", 42.5), drives = emptyList())
        assertEquals("42.50", d.value(SpeedGearMetric.Power))
        assertEquals("kW", d.unit(SpeedGearMetric.Power))
    }

    @Test
    fun powerRendersEmDashWhenAbsent() {
        val d = display(motor = MotorShift("D", null), drives = emptyList())
        assertEquals(DASH, d.value(SpeedGearMetric.Power))
        // The unit suffix is still shown (web always renders the `kW` span).
        assertEquals("kW", d.unit(SpeedGearMetric.Power))
    }

    @Test
    fun powerHonoursZeroPrecision() {
        val d = display(motor = MotorShift("D", 42.5), drives = emptyList(), prefs = prefs(precision = 0))
        assertEquals("43", d.value(SpeedGearMetric.Power))
    }

    // ── Shift cell color + badge (web shiftColor / shiftBadgeVariant) ─────────────

    @Test
    fun shiftAccentMapsEachCode() {
        assertEquals(ShiftAccent.Drive, SpeedGearPanelProjection.shiftAccent("D"))
        assertEquals(ShiftAccent.Reverse, SpeedGearPanelProjection.shiftAccent("R"))
        assertEquals(ShiftAccent.Neutral, SpeedGearPanelProjection.shiftAccent("N"))
        assertEquals(ShiftAccent.Park, SpeedGearPanelProjection.shiftAccent("P"))
        assertEquals(ShiftAccent.Unknown, SpeedGearPanelProjection.shiftAccent("X"))
        assertEquals(ShiftAccent.Unknown, SpeedGearPanelProjection.shiftAccent(null))
    }

    @Test
    fun shiftBadgeMapsEachCodeWithParkAndUnknownNeutral() {
        assertEquals(ShiftBadge.Success, SpeedGearPanelProjection.shiftBadge("D"))
        assertEquals(ShiftBadge.Danger, SpeedGearPanelProjection.shiftBadge("R"))
        assertEquals(ShiftBadge.Warning, SpeedGearPanelProjection.shiftBadge("N"))
        // Web `shiftBadgeVariant` has no `P` branch — it falls through to neutral, unlike `shiftColor`.
        assertEquals(ShiftBadge.Neutral, SpeedGearPanelProjection.shiftBadge("P"))
        assertEquals(ShiftBadge.Neutral, SpeedGearPanelProjection.shiftBadge(null))
    }

    @Test
    fun shiftLetterFallsBackToEmDashWhenAbsent() {
        val present = display(motor = MotorShift("R", 0.0), drives = emptyList())
        assertEquals("R", present.shift)
        assertEquals(ShiftAccent.Reverse, present.shiftAccent)
        assertEquals(ShiftBadge.Danger, present.shiftBadge)

        val absent = display(motor = null, drives = emptyList())
        assertEquals(DASH, absent.shift)
        assertEquals(ShiftAccent.Unknown, absent.shiftAccent)
        assertEquals(ShiftBadge.Neutral, absent.shiftBadge)
    }

    @Test
    fun metricsAreEmittedInWebSourceOrder() {
        val d = display(motor = MotorShift("D", 1.0), drives = emptyList())
        assertEquals(
            listOf(SpeedGearMetric.Power, SpeedGearMetric.AvgDriveSpeed, SpeedGearMetric.TopDriveSpeed),
            d.metrics.map { it.metric },
        )
    }

    // ── UiState projection (cache-then-network lifecycle) ────────────────────────

    @Test
    fun projectUiStateLoadingWinsOutright() {
        val state = SpeedGearPanelProjection.projectUiState(SpeedGearSnapshot(null, emptyList()), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun projectUiStateContentForAnyPresentSnapshot() {
        // A present snapshot — even motor-null with no drives — is Content (the cells render with em-dashes),
        // mirroring the web's always-present panel.
        val state = SpeedGearPanelProjection.projectUiState(SpeedGearSnapshot(null, emptyList()), isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
    }

    @Test
    fun projectUiStateEmptyForNullSnapshot() {
        val state = SpeedGearPanelProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
    }

    // ── MotorShift.fromJson (tolerant decode of /motor/latest) ───────────────────

    @Test
    fun fromJsonReadsSnakeCaseFields() {
        val obj =
            buildJsonObject {
                put("shift_state", "D")
                put("power_kw", 12.5)
            }
        val motor = MotorShift.fromJson(obj)!!
        assertEquals("D", motor.shiftState)
        assertEquals(12.5, motor.powerKw!!, 1e-9)
    }

    @Test
    fun fromJsonTreatsNonObjectAsNull() {
        assertNull(MotorShift.fromJson(null))
        assertNull(MotorShift.fromJson(JsonPrimitive("nope")))
    }

    @Test
    fun fromJsonTreatsAbsentAndNullFieldsAsNull() {
        val obj =
            buildJsonObject {
                put("shift_state", JsonNull)
                // power_kw absent entirely
            }
        val motor = MotorShift.fromJson(obj)!!
        assertNull(motor.shiftState)
        assertNull(motor.powerKw)
    }

    @Test
    fun fromJsonIgnoresNonNumericPowerAndNonStringShift() {
        val obj =
            buildJsonObject {
                put("shift_state", 5) // a number where a string is expected
                put("power_kw", "fast") // a string where a number is expected
            }
        val motor = MotorShift.fromJson(obj)!!
        assertNull(motor.shiftState)
        assertNull(motor.powerKw)
    }

    // ── Number formatting + locale ───────────────────────────────────────────────

    @Test
    fun formatNumberGroupsThousandsAndRoundsHalfUp() {
        assertEquals("1,235", SpeedGearPanelProjection.formatNumber(1234.5, 0, Locale.US))
        assertEquals("12.35", SpeedGearPanelProjection.formatNumber(12.345, 2, Locale.US))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZero() {
        assertEquals("0", SpeedGearPanelProjection.formatNumber(Double.NaN, 0, Locale.US))
        assertEquals("0", SpeedGearPanelProjection.formatNumber(Double.POSITIVE_INFINITY, 0, Locale.US))
        // A signed zero normalizes to positive zero, matching Intl.NumberFormat.
        assertEquals("0", SpeedGearPanelProjection.formatNumber(-0.0, 0, Locale.US))
    }

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
