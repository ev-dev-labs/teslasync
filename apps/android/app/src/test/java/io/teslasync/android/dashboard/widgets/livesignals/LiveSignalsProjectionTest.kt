package io.teslasync.android.dashboard.widgets.livesignals

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveSignalsWidget's pure logic — the JSON field decode + null guards, the
 * SI→display temperature/pressure conversion, the web `fmtInt`/`fmtNumber` + raw `${di_torque}` contracts,
 * the per-section projection branches (incl. the `null` ⇒ skeleton gate), the lock/sentry badge tones, the
 * TalkBack content descriptions (a11y label presence), and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/LiveSignalsWidget.tsx).
 */
class LiveSignalsProjectionTest {
    private val strings =
        LiveSignalsStrings(
            liveSignals = "Live Signals",
            noSignals = "No live signal data",
            motor = "Motor",
            torque = "Torque",
            motorTemp = "Temp",
            gear = "Gear",
            climate = "Climate",
            cabin = "Cabin",
            outside = "Outside",
            hvac = "HVAC",
            tires = "Tires",
            security = "Security",
            lock = "Lock",
            locked = "Locked",
            unlocked = "Unlocked",
            sentry = "Sentry",
            active = "Active",
            off = "Off",
        )

    private fun formatter(
        temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
        pressure: PressureUnitPref = PressureUnitPref.BAR,
    ): UnitFormatter =
        UnitFormatter(
            UnitPref(
                distance = DistanceUnitPref.KM,
                speed = SpeedUnitPref.KMH,
                temperature = temperature,
                pressure = pressure,
                energy = EnergyUnitPref.KWH,
                duration = DurationUnitPref.HOURS,
                power = PowerUnitPref.KW,
                locale = "en-US",
                precision = null,
            ),
        )

    // ---- Motor ---------------------------------------------------------------------

    @Test
    fun motorProjectsTorqueTempAndGear() {
        val snapshot =
            buildJsonObject {
                put("di_torque", 250)
                put("di_stator_temp", 45.0)
                put("gear", "D")
            }
        val display = LiveSignalsProjection.motor(snapshot, formatter(), strings)!!
        assertEquals("250 Nm", display.torque)
        assertEquals("45\u00b0C", display.temp)
        assertEquals("D", display.gear)
        assertEquals("Motor, Torque 250 Nm, Temp 45\u00b0C, Gear D", display.contentDescription)
    }

    @Test
    fun motorConvertsStatorTempToFahrenheit() {
        val snapshot = buildJsonObject { put("di_stator_temp", 20.0) }
        val display = LiveSignalsProjection.motor(snapshot, formatter(temperature = TemperatureUnitPref.FAHRENHEIT), strings)!!
        assertEquals("68\u00b0F", display.temp)
    }

    @Test
    fun motorShowsEmDashForMissingFieldsAndCleansNilGear() {
        val snapshot = buildJsonObject { put("gear", "<nil>") }
        val display = LiveSignalsProjection.motor(snapshot, formatter(), strings)!!
        assertEquals("\u2014", display.torque)
        assertEquals("\u2014", display.temp)
        assertEquals("\u2014", display.gear)
    }

    @Test
    fun motorRendersDecimalTorqueVerbatim() {
        val snapshot = buildJsonObject { put("di_torque", 245.6) }
        val display = LiveSignalsProjection.motor(snapshot, formatter(), strings)!!
        assertEquals("245.6 Nm", display.torque)
    }

    @Test
    fun motorIsNullWhenSnapshotNotAnObject() {
        assertNull(LiveSignalsProjection.motor(null, formatter(), strings))
        assertNull(LiveSignalsProjection.motor(JsonNull, formatter(), strings))
    }

    // ---- Climate -------------------------------------------------------------------

    @Test
    fun climateProjectsTemperaturesAndHvacPower() {
        val snapshot =
            buildJsonObject {
                put("inside_temp", 21.0)
                put("outside_temp", 12.0)
                put("hvac_power", 2.5)
            }
        val display = LiveSignalsProjection.climate(snapshot, formatter(), strings)!!
        assertEquals("21\u00b0C", display.cabin)
        assertEquals("12\u00b0C", display.outside)
        assertEquals("2.5 kW", display.hvac)
        assertEquals("Climate, Cabin 21\u00b0C, Outside 12\u00b0C, HVAC 2.5 kW", display.contentDescription)
    }

    @Test
    fun climateShowsEmDashForMissingReadings() {
        val display = LiveSignalsProjection.climate(buildJsonObject {}, formatter(), strings)!!
        assertEquals("\u2014", display.cabin)
        assertEquals("\u2014", display.outside)
        assertEquals("\u2014", display.hvac)
    }

    // ---- Tires ---------------------------------------------------------------------

    @Test
    fun tiresProjectCornersInBar() {
        val snapshot =
            buildJsonObject {
                put("front_left", 290.0)
                put("front_right", 289.0)
                put("rear_left", 280.0)
                put("rear_right", 281.0)
            }
        val display = LiveSignalsProjection.tires(snapshot, formatter(), strings)!!
        assertEquals("2.9 bar", display.frontLeft)
        assertEquals("2.9 bar", display.frontRight)
        assertEquals("2.8 bar", display.rearLeft)
        assertEquals("2.8 bar", display.rearRight)
        assertEquals("Tires, FL 2.9 bar, FR 2.9 bar, RL 2.8 bar, RR 2.8 bar", display.contentDescription)
    }

    @Test
    fun tiresConvertToPsi() {
        val snapshot = buildJsonObject { put("front_left", 290.0) }
        val display = LiveSignalsProjection.tires(snapshot, formatter(pressure = PressureUnitPref.PSI), strings)!!
        assertEquals("42.1 psi", display.frontLeft)
    }

    // ---- Security ------------------------------------------------------------------

    @Test
    fun securityLockedAndSentryActive() {
        val snapshot =
            buildJsonObject {
                put("locked", true)
                put("sentry_mode", true)
            }
        val display = LiveSignalsProjection.security(snapshot, strings)!!
        assertEquals("Locked", display.lockText)
        assertEquals(SignalBadge.Success, display.lockTone)
        assertEquals("Active", display.sentryText)
        assertEquals(SignalBadge.Success, display.sentryTone)
        assertEquals("Security, Lock Locked, Sentry Active", display.contentDescription)
    }

    @Test
    fun securityUnlockedAndSentryOff() {
        val snapshot =
            buildJsonObject {
                put("locked", false)
                put("sentry_mode", false)
            }
        val display = LiveSignalsProjection.security(snapshot, strings)!!
        assertEquals("Unlocked", display.lockText)
        assertEquals(SignalBadge.Danger, display.lockTone)
        assertEquals("Off", display.sentryText)
        assertEquals(SignalBadge.Neutral, display.sentryTone)
    }

    // ---- Aggregate + hasData -------------------------------------------------------

    @Test
    fun projectMarksHasDataWhenAnySectionPresent() {
        val state =
            LiveSignalsState.EMPTY.copy(
                motor = buildJsonObject { put("gear", "P") },
            )
        val display = LiveSignalsProjection.project(state, formatter(), strings)
        assertTrue(display.hasData)
        assertEquals("P", display.motor?.gear)
        assertNull(display.climate)
        assertNull(display.tires)
        assertNull(display.security)
    }

    @Test
    fun projectHasNoDataWhenEveryFeedEmpty() {
        val display = LiveSignalsProjection.project(LiveSignalsState.EMPTY, formatter(), strings)
        assertFalse(display.hasData)
        assertNull(display.motor)
        assertNull(display.climate)
        assertNull(display.tires)
        assertNull(display.security)
    }

    @Test
    fun cleanNilDropsGoNilSentinels() {
        assertNull(LiveSignalsProjection.cleanNil(null))
        assertNull(LiveSignalsProjection.cleanNil(""))
        assertNull(LiveSignalsProjection.cleanNil("<nil>"))
        assertNull(LiveSignalsProjection.cleanNil("nil"))
        assertNull(LiveSignalsProjection.cleanNil("null"))
        assertEquals("R", LiveSignalsProjection.cleanNil("R"))
    }

    // ---- Registry ------------------------------------------------------------------

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("live-signals", LiveSignalsRegistration.ID)
        assertEquals("telemetry", LiveSignalsRegistration.CATEGORY)
        assertEquals("LiveSignalsWidget", LiveSignalsRegistration.SLUG)
        assertEquals(LiveSignalsSize(cols = 2, rows = 4), LiveSignalsRegistration.DEFAULT_SIZE)
        assertEquals(LiveSignalsSize(cols = 2, rows = 2), LiveSignalsRegistration.MIN_SIZE)
        assertEquals(LiveSignalsSize(cols = 4, rows = 40), LiveSignalsRegistration.MAX_SIZE)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(LiveSignalsSize(cols = 4, rows = 40), LiveSignalsRegistration.clamp(LiveSignalsSize(9, 99)))
        assertEquals(LiveSignalsSize(cols = 2, rows = 2), LiveSignalsRegistration.clamp(LiveSignalsSize(0, 0)))
        assertTrue(LiveSignalsRegistration.isWithinBounds(LiveSignalsSize(2, 4)))
        assertFalse(LiveSignalsRegistration.isWithinBounds(LiveSignalsSize(1, 4)))
    }
}
