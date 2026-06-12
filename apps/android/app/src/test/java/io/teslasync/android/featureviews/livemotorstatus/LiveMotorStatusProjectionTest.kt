package io.teslasync.android.featureviews.livemotorstatus

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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the LiveMotorStatus pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx): the
 * `motorLatest != null` presence gate, the per-field `… != null ? '<value> <unit>' : '—'` formatting, the
 * `fmtNumber` / `fmtInt` number formatting, the SI → display temperature conversion, and the HV-isolation
 * color ternary. Because the surface is presentational, each [LiveMotorStatusDisplay] is exactly what the
 * thin composable renders, so these assertions double as the per-state adapter "snapshot".
 */
class LiveMotorStatusProjectionTest {
    private fun prefs(
        temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
        precision: Int? = 2,
        locale: String? = "en-US",
    ): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = locale,
            precision = precision,
        )

    private fun fullMotor(): MotorLive =
        MotorLive(
            shiftState = "D",
            powerKw = 42.5,
            regenKw = 0.0,
            source = "telemetry",
            motorRpmFront = 1240.0,
            motorRpmRear = 1238.0,
            torqueNmFront = 180.0,
            torqueNmRear = 175.0,
            motorTempCFront = 48.0,
            motorTempCRear = 47.0,
            inverterTempC = 52.0,
            batteryTempC = 31.0,
        )

    private fun summaryValue(
        display: LiveMotorStatusDisplay,
        key: MotorSummaryKey,
    ): String = display.summary.first { it.key == key }.value

    private fun metric(
        display: LiveMotorStatusDisplay,
        key: MotorMetricKey,
    ): MotorMetric = display.metrics.first { it.key == key }

    // ── formatNumber(): web `fmtNumber(value, decimals)` ─────────────────────────

    @Test
    fun formatNumberAlwaysShowsTheRequestedFractionDigits() {
        assertEquals("42.50", LiveMotorStatusProjection.formatNumber(42.5, 2, Locale.US))
        assertEquals("0.00", LiveMotorStatusProjection.formatNumber(0.0, 2, Locale.US))
        assertEquals("1,240", LiveMotorStatusProjection.formatNumber(1240.0, 0, Locale.US))
    }

    @Test
    fun formatNumberRoundsHalfAwayFromZero() {
        // ECMAScript Intl default "halfExpand": 2.5 -> "3", 1.6 -> "2", 1.4 -> "1".
        assertEquals("3", LiveMotorStatusProjection.formatNumber(2.5, 0, Locale.US))
        assertEquals("2", LiveMotorStatusProjection.formatNumber(1.6, 0, Locale.US))
        assertEquals("1", LiveMotorStatusProjection.formatNumber(1.4, 0, Locale.US))
        assertEquals("1,234.57", LiveMotorStatusProjection.formatNumber(1234.567, 2, Locale.US))
    }

    @Test
    fun formatNumberGroupsThousandsLikeToLocaleString() {
        assertEquals("12,345", LiveMotorStatusProjection.formatNumber(12345.0, 0, Locale.US))
    }

    @Test
    fun formatNumberHonorsTheLocaleSeparators() {
        // Web `toLocaleString(locale)` varies by locale: de-DE groups with "." and uses "," for decimals.
        assertEquals("1.234,5", LiveMotorStatusProjection.formatNumber(1234.5, 1, Locale.GERMANY))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZeroAndNormalizesNegativeZero() {
        assertEquals("0.00", LiveMotorStatusProjection.formatNumber(Double.NaN, 2, Locale.US))
        assertEquals("0.00", LiveMotorStatusProjection.formatNumber(Double.POSITIVE_INFINITY, 2, Locale.US))
        assertEquals("0.00", LiveMotorStatusProjection.formatNumber(-0.0, 2, Locale.US))
    }

    // ── isolationAccent(): web Shield color ternary ──────────────────────────────

    @Test
    fun isolationAccentMatchesTheWebTernary() {
        assertEquals(MotorAccent.Muted, LiveMotorStatusProjection.isolationAccent(null))
        assertEquals(MotorAccent.Muted, LiveMotorStatusProjection.isolationAccent(0.0))
        assertEquals(MotorAccent.Muted, LiveMotorStatusProjection.isolationAccent(-5.0))
        assertEquals(MotorAccent.Green, LiveMotorStatusProjection.isolationAccent(640.0))
        assertEquals(MotorAccent.Green, LiveMotorStatusProjection.isolationAccent(500.0))
        assertEquals(MotorAccent.Amber, LiveMotorStatusProjection.isolationAccent(499.0))
        assertEquals(MotorAccent.Amber, LiveMotorStatusProjection.isolationAccent(100.0))
        assertEquals(MotorAccent.Red, LiveMotorStatusProjection.isolationAccent(99.0))
        assertEquals(MotorAccent.Red, LiveMotorStatusProjection.isolationAccent(1.0))
    }

    // ── project(): per-state ─────────────────────────────────────────────────────

    @Test
    fun projectNullMotorHasNoDataAndEmptyGrids() {
        val display =
            LiveMotorStatusProjection.project(
                motor = null,
                isolationResistance = 640.0,
                loading = false,
                prefs = prefs(),
                locale = Locale.US,
            )

        assertFalse(display.hasData)
        assertFalse(display.loading)
        assertTrue(display.summary.isEmpty())
        assertTrue(display.metrics.isEmpty())
    }

    @Test
    fun projectThreadsLoadingFlagEvenWithoutData() {
        val display =
            LiveMotorStatusProjection.project(
                motor = null,
                isolationResistance = null,
                loading = true,
                prefs = prefs(),
                locale = Locale.US,
            )

        assertTrue(display.loading)
        assertFalse(display.hasData)
    }

    @Test
    fun projectFullSnapshotFormatsEverySummaryTileAndMetricInCelsius() {
        val display =
            LiveMotorStatusProjection.project(
                motor = fullMotor(),
                isolationResistance = 640.0,
                loading = false,
                prefs = prefs(),
                locale = Locale.US,
            )

        assertTrue(display.hasData)
        // Summary tiles (web top grid).
        assertEquals("D", summaryValue(display, MotorSummaryKey.ShiftState))
        assertEquals("42.50 kW", summaryValue(display, MotorSummaryKey.Power))
        assertEquals("0.00 kW", summaryValue(display, MotorSummaryKey.Regen))
        assertEquals("telemetry", summaryValue(display, MotorSummaryKey.Source))
        // Inline metrics (web bottom grid).
        assertEquals("1,240 RPM", metric(display, MotorMetricKey.RpmFront).value)
        assertEquals("1,238 RPM", metric(display, MotorMetricKey.RpmRear).value)
        assertEquals("180.00 Nm", metric(display, MotorMetricKey.TorqueFront).value)
        assertEquals("175.00 Nm", metric(display, MotorMetricKey.TorqueRear).value)
        assertEquals("48.00 \u00B0C", metric(display, MotorMetricKey.MotorTempFront).value)
        assertEquals("47.00 \u00B0C", metric(display, MotorMetricKey.MotorTempRear).value)
        assertEquals("52.00 \u00B0C", metric(display, MotorMetricKey.InverterTemp).value)
        assertEquals("31.00 \u00B0C", metric(display, MotorMetricKey.BatteryTemp).value)
        assertEquals("640.00 k\u03A9", metric(display, MotorMetricKey.HvIsolation).value)
    }

    @Test
    fun projectAppliesTheWebAccentToEveryCell() {
        val display =
            LiveMotorStatusProjection.project(
                motor = fullMotor(),
                isolationResistance = 640.0,
                loading = false,
                prefs = prefs(),
                locale = Locale.US,
            )

        assertEquals(MotorAccent.Cyan, display.summary.first { it.key == MotorSummaryKey.ShiftState }.accent)
        assertEquals(MotorAccent.Purple, display.summary.first { it.key == MotorSummaryKey.Power }.accent)
        assertEquals(MotorAccent.Green, display.summary.first { it.key == MotorSummaryKey.Regen }.accent)
        assertEquals(MotorAccent.Primary, display.summary.first { it.key == MotorSummaryKey.Source }.accent)

        assertEquals(MotorAccent.Cyan, metric(display, MotorMetricKey.RpmFront).accent)
        assertEquals(MotorAccent.Purple, metric(display, MotorMetricKey.RpmRear).accent)
        assertEquals(MotorAccent.Cyan, metric(display, MotorMetricKey.TorqueFront).accent)
        assertEquals(MotorAccent.Purple, metric(display, MotorMetricKey.TorqueRear).accent)
        assertEquals(MotorAccent.Red, metric(display, MotorMetricKey.MotorTempFront).accent)
        assertEquals(MotorAccent.Red, metric(display, MotorMetricKey.MotorTempRear).accent)
        assertEquals(MotorAccent.Amber, metric(display, MotorMetricKey.InverterTemp).accent)
        assertEquals(MotorAccent.Green, metric(display, MotorMetricKey.BatteryTemp).accent)
        assertEquals(MotorAccent.Green, metric(display, MotorMetricKey.HvIsolation).accent)
    }

    @Test
    fun projectFahrenheitConvertsTemperaturesFromSi() {
        val display =
            LiveMotorStatusProjection.project(
                motor = fullMotor(),
                isolationResistance = 640.0,
                loading = false,
                prefs = prefs(temperature = TemperatureUnitPref.FAHRENHEIT),
                locale = Locale.US,
            )

        // 48°C -> 118.4°F, 31°C -> 87.8°F, with the unit label switched.
        assertEquals("118.40 \u00B0F", metric(display, MotorMetricKey.MotorTempFront).value)
        assertEquals("87.80 \u00B0F", metric(display, MotorMetricKey.BatteryTemp).value)
    }

    @Test
    fun projectPresentButEmptySnapshotRendersDashesNeverBlanks() {
        // Web nuance: a present snapshot whose every reading is null still renders the grids (hasData =
        // motorLatest != null), each cell showing the em-dash — only an absent snapshot selects the empty state.
        val display =
            LiveMotorStatusProjection.project(
                motor = MotorLive(null, null, null, null, null, null, null, null, null, null, null, null),
                isolationResistance = null,
                loading = false,
                prefs = prefs(),
                locale = Locale.US,
            )

        assertTrue(display.hasData)
        assertEquals(DASH, summaryValue(display, MotorSummaryKey.ShiftState))
        assertEquals(DASH, summaryValue(display, MotorSummaryKey.Power))
        assertEquals(DASH, summaryValue(display, MotorSummaryKey.Source))
        display.metrics.forEach { assertEquals(DASH, it.value) }
        assertEquals(MotorAccent.Muted, metric(display, MotorMetricKey.HvIsolation).accent)
    }

    @Test
    fun projectNonPositiveIsolationRendersDashAndMutedAccent() {
        val display =
            LiveMotorStatusProjection.project(fullMotor(), isolationResistance = 0.0, loading = false, prefs = prefs(), locale = Locale.US)

        assertEquals(DASH, metric(display, MotorMetricKey.HvIsolation).value)
        assertEquals(MotorAccent.Muted, metric(display, MotorMetricKey.HvIsolation).accent)
    }

    @Test
    fun projectUsesDefaultPrecisionWhenSettingsOmitIt() {
        // Web `fmtNumber` falls back to the global precision default (2) when `decimal_precision` is unset.
        val display =
            LiveMotorStatusProjection.project(
                motor = fullMotor(),
                isolationResistance = 640.0,
                loading = false,
                prefs = prefs(precision = null),
                locale = Locale.US,
            )

        assertEquals("42.50 kW", summaryValue(display, MotorSummaryKey.Power))
    }

    // ── MotorLive.fromJson(): cache-then-network parse ───────────────────────────

    @Test
    fun fromJsonDecodesTheSnakeCaseWireContract() {
        val element =
            buildJsonObject {
                put("shift_state", "R")
                put("power_kw", 12.0)
                put("regen_kw", 3.0)
                put("source", "fleet")
                put("motor_rpm_front", 900.0)
                put("motor_rpm_rear", 905.0)
                put("torque_nm_front", 50.0)
                put("torque_nm_rear", 48.0)
                put("motor_temp_c_front", 40.0)
                put("motor_temp_c_rear", 41.0)
                put("inverter_temp_c", 55.0)
                put("battery_temp_c", 25.0)
            }

        val motor = MotorLive.fromJson(element)

        assertEquals("R", motor?.shiftState)
        assertEquals(12.0, motor?.powerKw)
        assertEquals(3.0, motor?.regenKw)
        assertEquals("fleet", motor?.source)
        assertEquals(900.0, motor?.motorRpmFront)
        assertEquals(40.0, motor?.motorTempCFront)
        assertEquals(55.0, motor?.inverterTempC)
        assertEquals(25.0, motor?.batteryTempC)
    }

    @Test
    fun fromJsonReturnsNullForAbsentOrNonObjectBodies() {
        assertNull(MotorLive.fromJson(null))
        assertNull(MotorLive.fromJson(JsonNull))
        assertNull(MotorLive.fromJson(JsonPrimitive("not-an-object")))
    }

    @Test
    fun fromJsonDecodesAnEmptyObjectToAnAllNullSnapshot() {
        val motor = MotorLive.fromJson(buildJsonObject {})

        assertNull(motor?.shiftState)
        assertNull(motor?.powerKw)
        assertNull(motor?.motorTempCFront)
        // A present-but-empty object is still a non-null snapshot (web `hasData = motorLatest != null`).
        assertTrue(motor != null)
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
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }
}
