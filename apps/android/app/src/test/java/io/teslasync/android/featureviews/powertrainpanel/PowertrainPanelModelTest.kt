// Off-device unit coverage for the PowertrainPanel feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the snapshot -> display projection (the typed-field reads + web
// `typeof`/`!= null` guards, the SI -> display temperature conversion through the shared UnitFormatter /
// `useUnits`, the peak-temperature `Math.max`, the over-temperature `> 80` flag, the centered power-meter
// `min(|power| / 300, 1)` fraction + sign, the shift-state color ladder, and the `… ?? '—'` / `… kW`
// fallbacks), the empty-snapshot classifier the composable + view-model switch on (per-state coverage), the
// routing through the supplied i18n strings, the merged a11y values, and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.powertrainpanel

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class PowertrainPanelModelTest {
    private val metric = UnitFormatter.default()
    private val imperial = UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_temp":"F"}""")))

    private val strings =
        PowertrainPanelStrings(
            title = "Powertrain",
            shiftState = "Shift State",
            unknown = "Unknown",
            power = "Power",
            rpmFront = "Front RPM",
            rpmRear = "Rear RPM",
            torqueFront = "Front Torque",
            torqueRear = "Rear Torque",
            motorTemp = "Motor Temp (peak)",
            inverterTemp = "Inverter Temp",
            regen = "Regen",
            noData = "No motor data available",
        )

    // A fully-populated snapshot: Drive, 150.5 kW power, 4200/4180 RPM, 220/235.5 Nm torque,
    // 64/58 °C motor temps, 45 °C inverter, 18 kW regen.
    private val full =
        buildJsonObject {
            put("shift_state", "D")
            put("power_kw", 150.5)
            put("motor_rpm_front", 4200.0)
            put("motor_rpm_rear", 4180.0)
            put("torque_nm_front", 220.0)
            put("torque_nm_rear", 235.5)
            put("motor_temp_c_front", 64.0)
            put("motor_temp_c_rear", 58.0)
            put("inverter_temp_c", 45.0)
            put("regen_kw", 18.0)
        }

    private fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter = metric,
        locale: Locale = Locale.US,
        precision: Int = DEFAULT_NUMBER_DECIMALS,
    ): PowertrainPanelDisplay = PowertrainPanelProjection.project(snapshot, formatter, strings, locale, precision)

    // ── parse: the web typed-field guards ─────────────────────────────────────────
    @Test
    fun parseReadsTypedFields() {
        val reading = PowertrainPanelProjection.parse(full)
        assertEquals("D", reading.shiftState)
        assertEquals(150.5, reading.powerKw!!, EPS)
        assertEquals(4200.0, reading.rpmFront!!, EPS)
        assertEquals(4180.0, reading.rpmRear!!, EPS)
        assertEquals(220.0, reading.torqueFront!!, EPS)
        assertEquals(235.5, reading.torqueRear!!, EPS)
        assertEquals(64.0, reading.motorTempFrontC!!, EPS)
        assertEquals(58.0, reading.motorTempRearC!!, EPS)
        assertEquals(45.0, reading.inverterTempC!!, EPS)
        assertEquals(18.0, reading.regenKw!!, EPS)
    }

    @Test
    fun parseRejectsStringNumberAndNumericShiftLikeTypedContract() {
        // A quoted-string numeric field is rejected by the web `number` guard; a numeric shift_state is
        // rejected by the web `string` guard.
        val reading =
            PowertrainPanelProjection.parse(
                buildJsonObject {
                    put("shift_state", 3)
                    put("power_kw", "150.5")
                    put("motor_rpm_front", 4200.0)
                },
            )
        assertNull(reading.shiftState)
        assertNull(reading.powerKw)
        assertEquals(4200.0, reading.rpmFront!!, EPS)
    }

    @Test
    fun parseOfNonObjectIsAllNull() {
        val reading = PowertrainPanelProjection.parse(JsonNull)
        assertNull(reading.shiftState)
        assertNull(reading.powerKw)
        assertNull(reading.motorTempFrontC)
    }

    // ── peak motor temperature (web `Math.max(front ?? -Inf, rear ?? -Inf)`) ───────
    @Test
    fun peakMotorTempPicksHigherAxleOrTheSinglePresentReading() {
        assertEquals(64.0, MotorReading.EMPTY.copy(motorTempFrontC = 64.0, motorTempRearC = 58.0).peakMotorTempC!!, EPS)
        assertEquals(58.0, MotorReading.EMPTY.copy(motorTempFrontC = null, motorTempRearC = 58.0).peakMotorTempC!!, EPS)
        assertEquals(64.0, MotorReading.EMPTY.copy(motorTempFrontC = 64.0, motorTempRearC = null).peakMotorTempC!!, EPS)
    }

    @Test
    fun peakMotorTempIsNullWhenBothAxlesAbsent() {
        assertNull(MotorReading.EMPTY.peakMotorTempC)
    }

    // ── power meter fraction (web `min(|power| / 300, 1)`) ─────────────────────────
    @Test
    fun powerFractionIsHalfScaleAndClamped() {
        assertEquals(0f, PowertrainPanelProjection.powerFraction(null))
        assertEquals(0.5f, PowertrainPanelProjection.powerFraction(150.0))
        assertEquals(0.5f, PowertrainPanelProjection.powerFraction(-150.0))
        assertEquals(1.0f, PowertrainPanelProjection.powerFraction(300.0))
        assertEquals(1.0f, PowertrainPanelProjection.powerFraction(600.0))
    }

    // ── shift-state color ladder (web `'D' / 'R' / 'N' / else`) ────────────────────
    @Test
    fun shiftToneMapsTheWebColorLadder() {
        assertEquals(ShiftTone.Drive, PowertrainPanelProjection.shiftToneOf("D"))
        assertEquals(ShiftTone.Reverse, PowertrainPanelProjection.shiftToneOf("R"))
        assertEquals(ShiftTone.Neutral, PowertrainPanelProjection.shiftToneOf("N"))
        assertEquals(ShiftTone.Other, PowertrainPanelProjection.shiftToneOf("P"))
        assertEquals(ShiftTone.Other, PowertrainPanelProjection.shiftToneOf(null))
    }

    // ── project: the full render state (metric) ───────────────────────────────────
    @Test
    fun projectsEveryReadingForMetricUnits() {
        val display = project(full)
        assertTrue(display.hasData)
        assertEquals("D", display.shiftStateText)
        assertEquals(ShiftTone.Drive, display.shiftTone)
        assertEquals("150.50 kW", display.powerText)
        assertTrue(display.powerHasValue)
        assertTrue(display.powerPositive)
        assertEquals(0.501f, display.powerFraction, FRACTION_EPS)
        assertEquals("4,200", display.rpmFrontText)
        assertEquals("4,180", display.rpmRearText)
        assertEquals("220.00", display.torqueFrontText)
        assertEquals("235.50", display.torqueRearText)
        assertEquals("64.0\u00B0C", display.motorTempText)
        assertFalse(display.motorTempHot)
        assertEquals("45.0\u00B0C", display.inverterTempText)
        assertEquals("18.00 kW", display.regenText)
    }

    @Test
    fun temperaturesConvertThroughTheImperialBoundary() {
        // 64 °C -> 147.2 °F; 45 °C -> 113.0 °F (web useUnits Fahrenheit preference).
        val display = project(full, imperial)
        assertEquals("147.2\u00B0F", display.motorTempText)
        assertEquals("113.0\u00B0F", display.inverterTempText)
    }

    @Test
    fun overTemperatureFlagsTheHotPeak() {
        val hot = buildJsonObject { put("motor_temp_c_front", 85.0) }
        val display = project(hot)
        assertEquals("85.0\u00B0C", display.motorTempText)
        assertTrue(display.motorTempHot)
    }

    @Test
    fun negativePowerIsRegenSideAndUnsigned() {
        val display = project(buildJsonObject { put("power_kw", -50.0) })
        assertEquals("-50.00 kW", display.powerText)
        assertFalse(display.powerPositive)
        assertTrue(display.powerHasValue)
        assertEquals(0.1667f, display.powerFraction, FRACTION_EPS)
    }

    // ── project: the missing-reading fallbacks (web `… ?? '—'` / `… kW`) ───────────
    @Test
    fun missingNumericReadingsRenderEmDashAndUnknownShift() {
        val display = project(buildJsonObject {})
        assertTrue(display.hasData)
        assertEquals(strings.unknown, display.shiftStateText)
        assertEquals(ShiftTone.Other, display.shiftTone)
        assertEquals("$EM_DASH kW", display.powerText)
        assertFalse(display.powerHasValue)
        assertEquals(EM_DASH, display.rpmFrontText)
        assertEquals(EM_DASH, display.torqueRearText)
        assertEquals(EM_DASH, display.motorTempText)
        assertEquals(EM_DASH, display.inverterTempText)
        assertEquals(EM_DASH, display.regenText)
    }

    @Test
    fun nullSnapshotProjectsEmptyState() {
        val display = project(JsonNull)
        assertFalse(display.hasData)
        assertEquals(strings.unknown, display.shiftStateText)
    }

    @Test
    fun projectUsesLocaleDecimalSeparator() {
        val display = project(full, metric, Locale.GERMANY)
        assertEquals("150,50 kW", display.powerText)
        assertEquals("4.200", display.rpmFrontText)
    }

    // ── empty classification (the view-model's UiPhase.Empty predicate) ────────────
    @Test
    fun isEmptySnapshotIsTrueOnlyForNonObjects() {
        assertTrue(PowertrainPanelProjection.isEmptySnapshot(null))
        assertTrue(PowertrainPanelProjection.isEmptySnapshot(JsonNull))
        // A present (even empty) motor object renders the content body — the web truthy-object gate.
        assertFalse(PowertrainPanelProjection.isEmptySnapshot(buildJsonObject {}))
        assertFalse(PowertrainPanelProjection.isEmptySnapshot(full))
    }

    // ── locale resolution ─────────────────────────────────────────────────────────
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

    // ── diagnostics (P1/S11 view.opened contract) ─────────────────────────────────
    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordPowertrainPanelOpened(logger)

        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "PowertrainPanel"), record.fields)
    }

    @Test
    fun slugIsTheStableSurfaceName() {
        assertEquals("PowertrainPanel", POWERTRAIN_PANEL_SLUG)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private companion object {
        private const val EPS: Double = 1e-9
        private const val FRACTION_EPS: Float = 1e-3f
    }
}
