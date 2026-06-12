package io.teslasync.android.featureviews.livemotorstatus.drivingdynamics

import io.teslasync.android.featureviews.livemotorstatus.MotorLive
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
 * Off-device verification of the driving-dynamics LiveMotorStatus pure logic — the native mirror of every
 * derivation the web component performs
 * (web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx): the `motorLatest != null`
 * presence gate, the `(torque_nm_front ?? 0) + (torque_nm_rear ?? 0)` sum, the `motor_rpm_front ?? 0` read,
 * the `max(motor_temp_c_front ?? -Inf, motor_temp_c_rear ?? -Inf)` SI → display conversion (with the
 * "Awaiting data" fallback), each gauge's `[0, max]` clamp + `Number.isInteger(clamped) ? 0 :
 * getGlobalPrecision()` fraction rule, the `fmtNumber` captions, and the `shift_state === 'D'` success
 * selection. Because the surface is presentational, each [DrivingDynamicsLiveMotorStatusDisplay] is exactly
 * what the thin composable renders, so these assertions double as the per-state adapter "snapshot".
 */
class DrivingDynamicsLiveMotorStatusProjectionTest {
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

    private fun strings(): DrivingDynamicsLiveMotorStatusStrings =
        DrivingDynamicsLiveMotorStatusStrings(
            title = "Live Motor Status",
            torque = "Torque",
            rpmFront = "Front RPM",
            motorTemp = "Motor",
            shiftState = "Shift State",
            awaiting = "Awaiting data",
            unknown = "Unknown",
            noData = "Awaiting live motor data",
            loadingLabel = "Loading",
        )

    /** A full snapshot (Drive, 1240 front RPM, 180/175 Nm axles, 48/47°C). Tests vary fields via [MotorLive.copy]. */
    private fun motor(): MotorLive =
        MotorLive(
            shiftState = "D",
            powerKw = null,
            regenKw = null,
            source = null,
            motorRpmFront = 1240.0,
            motorRpmRear = null,
            torqueNmFront = 180.0,
            torqueNmRear = 175.0,
            motorTempCFront = 48.0,
            motorTempCRear = 47.0,
            inverterTempC = null,
            batteryTempC = null,
        )

    private fun project(
        motor: MotorLive?,
        prefs: UnitPref = prefs(),
        locale: Locale = Locale.US,
        loading: Boolean = false,
    ): DrivingDynamicsLiveMotorStatusDisplay =
        DrivingDynamicsLiveMotorStatusProjection.project(
            motor = motor,
            strings = strings(),
            prefs = prefs,
            locale = locale,
            loading = loading,
        )

    private fun gauge(
        display: DrivingDynamicsLiveMotorStatusDisplay,
        accent: MotorGaugeAccent,
    ): MotorGauge = display.gauges.first { it.accent == accent }

    // ── presence gate ────────────────────────────────────────────────────────────

    @Test
    fun nullMotorHasNoDataAndNoCells() {
        val display = project(motor = null)

        assertFalse(display.hasData)
        assertFalse(display.loading)
        assertTrue(display.gauges.isEmpty())
        assertNull(display.shift)
    }

    @Test
    fun loadingFlagThreadsEvenWithoutData() {
        val display = project(motor = null, loading = true)

        assertTrue(display.loading)
        assertFalse(display.hasData)
    }

    // ── full snapshot (Celsius) ───────────────────────────────────────────────────

    @Test
    fun fullSnapshotResolvesThreeGaugesInWebOrderWithAccents() {
        val display = project(motor())

        assertTrue(display.hasData)
        assertEquals(3, display.gauges.size)
        assertEquals(MotorGaugeAccent.Torque, display.gauges[0].accent)
        assertEquals(MotorGaugeAccent.Rpm, display.gauges[1].accent)
        assertEquals(MotorGaugeAccent.Temp, display.gauges[2].accent)
    }

    @Test
    fun torqueGaugeSumsAxlesOverA1000NmTrack() {
        val torque = gauge(project(motor()), MotorGaugeAccent.Torque)

        // 180 + 175 = 355, an integer within [0, 1000] → 0 decimals, caption at the user precision.
        assertEquals("Torque", torque.label)
        assertEquals(355.0, torque.value, 0.0)
        assertEquals(1000.0, torque.max, 0.0)
        assertEquals("Nm", torque.unit)
        assertEquals(0, torque.decimals)
        assertEquals("355.00 Nm", torque.caption)
    }

    @Test
    fun rpmGaugeReadsFrontAxleOverAn18000Track() {
        val rpm = gauge(project(motor()), MotorGaugeAccent.Rpm)

        assertEquals("Front RPM", rpm.label)
        assertEquals(1240.0, rpm.value, 0.0)
        assertEquals(18000.0, rpm.max, 0.0)
        assertEquals("RPM", rpm.unit)
        assertEquals(0, rpm.decimals)
        assertEquals("1,240 RPM", rpm.caption)
    }

    @Test
    fun tempGaugeTakesTheHotterAxleAndShowsCelsius() {
        // max(48, 47) = 48°C; the caption is one decimal with no space before the unit (web parity).
        val temp = gauge(project(motor()), MotorGaugeAccent.Temp)

        assertEquals("Motor", temp.label)
        assertEquals(48.0, temp.value, 0.0)
        assertEquals(200.0, temp.max, 0.0)
        assertEquals("\u00B0C", temp.unit)
        assertEquals("48.0\u00B0C", temp.caption)
    }

    @Test
    fun shiftTileIsSuccessForDrive() {
        val shift = project(motor()).shift

        assertEquals("Shift State", shift?.label)
        assertEquals("D", shift?.value)
        assertEquals(true, shift?.isDrive)
    }

    // ── Fahrenheit + locale ───────────────────────────────────────────────────────

    @Test
    fun fahrenheitConvertsTheTemperatureAndItsCaption() {
        val temp = gauge(project(motor(), prefs(temperature = TemperatureUnitPref.FAHRENHEIT)), MotorGaugeAccent.Temp)

        // 48°C → 118.4°F, a non-integer value (gauge centers at the user precision; caption at one decimal).
        assertEquals(118.4, temp.value, 0.001)
        assertEquals("\u00B0F", temp.unit)
        assertEquals(2, temp.decimals)
        assertEquals("118.4\u00B0F", temp.caption)
    }

    @Test
    fun captionsHonorTheLocaleSeparators() {
        // Web `toLocaleString(locale)`: de-DE groups thousands with ".".
        val rpm = gauge(project(motor(), locale = Locale.GERMANY), MotorGaugeAccent.Rpm)

        assertEquals("1.240 RPM", rpm.caption)
    }

    // ── empty / clamp / precision / shift branches ──────────────────────────────────

    @Test
    fun absentTemperatureShowsAwaitingCaptionAndAZeroGauge() {
        val temp =
            gauge(project(motor().copy(motorTempCFront = null, motorTempCRear = null)), MotorGaugeAccent.Temp)

        assertEquals(0.0, temp.value, 0.0)
        assertEquals("Awaiting data", temp.caption)
    }

    @Test
    fun gaugeValueClampsIntoTheTrackButTheCaptionKeepsTheRawValue() {
        // 900 + 800 = 1700 Nm exceeds the 1000 Nm track; the gauge clamps but the caption shows the real sum.
        val torque =
            gauge(project(motor().copy(torqueNmFront = 900.0, torqueNmRear = 800.0)), MotorGaugeAccent.Torque)

        assertEquals(1000.0, torque.value, 0.0)
        assertEquals("1,700.00 Nm", torque.caption)
    }

    @Test
    fun aFractionalValueRendersTheGaugeCenterAtTheUserPrecision() {
        val torque =
            gauge(project(motor().copy(torqueNmFront = 355.5, torqueNmRear = 0.0)), MotorGaugeAccent.Torque)

        assertEquals(355.5, torque.value, 0.0)
        assertEquals(2, torque.decimals)
        assertEquals("355.50 Nm", torque.caption)
    }

    @Test
    fun nullTorquesAndRpmCollapseToZero() {
        val display = project(motor().copy(motorRpmFront = null, torqueNmFront = null, torqueNmRear = null))

        assertEquals("0.00 Nm", gauge(display, MotorGaugeAccent.Torque).caption)
        assertEquals(0.0, gauge(display, MotorGaugeAccent.Torque).value, 0.0)
        assertEquals("0 RPM", gauge(display, MotorGaugeAccent.Rpm).caption)
    }

    @Test
    fun missingPrecisionFallsBackToTwoDecimals() {
        val torque = gauge(project(motor(), prefs(precision = null)), MotorGaugeAccent.Torque)

        assertEquals("355.00 Nm", torque.caption)
    }

    @Test
    fun nonDriveGearIsNeutralAndAbsentGearIsUnknown() {
        val reverse = project(motor().copy(shiftState = "R")).shift
        assertEquals("R", reverse?.value)
        assertEquals(false, reverse?.isDrive)

        val absent = project(motor().copy(shiftState = null)).shift
        assertEquals("Unknown", absent?.value)
        assertEquals(false, absent?.isDrive)
    }
}
