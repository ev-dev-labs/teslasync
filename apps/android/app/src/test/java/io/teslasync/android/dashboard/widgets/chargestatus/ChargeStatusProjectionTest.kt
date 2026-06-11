package io.teslasync.android.dashboard.widgets.chargestatus

import io.teslasync.shared.core.api.generated.VehicleState
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

/**
 * Off-device verification of the ChargeStatusWidget's pure logic — the SI→display unit conversion, the
 * web `fmtNumber`/`fmtInt` number contract (en-US grouping, fixed digits, half-expand rounding), the
 * charging / not-charging / no-data projection branches, the TalkBack content descriptions, and the
 * registry metadata. Mirrors the web spec (web/src/features/dashboard/widgets/ChargeStatusWidget.tsx).
 */
class ChargeStatusProjectionTest {
    private val strings =
        ChargeStatusStrings(
            charging = "Charging",
            power = "Power",
            rate = "Rate",
            battery = "Battery",
            timeToFull = "Time to Full",
            notCharging = "Not Charging",
            noChargeData = "No charge data",
        )

    private fun prefs(
        distance: DistanceUnitPref = DistanceUnitPref.MI,
        precision: Int? = null,
    ): UnitPref =
        UnitPref(
            distance = distance,
            speed = if (distance == DistanceUnitPref.MI) SpeedUnitPref.MPH else SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            precision = precision,
        )

    // SI inputs chosen to land on round display values: chargeRate 80467.2 m/h = 50 mi/h = 80 km/h;
    // ratedRange 402336 m = 250 mi = 402.336 km; chargerPower 11 kW; battery 72%.
    private fun state(
        isCharging: Boolean = false,
        timeToFullCharge: Double = 1.5,
    ): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 80_467.2,
            chargerPower = 11.0,
            idealRange = 0.0,
            insideTemp = 0.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = 402_336.0,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = timeToFullCharge,
            vehicleId = 5,
        )

    private fun project(
        state: VehicleState?,
        prefs: UnitPref = prefs(),
    ): ChargeStatusDisplay = ChargeStatusProjection.project(state, prefs, strings)

    @Test
    fun nullStateProjectsNoData() {
        val display = project(null)
        assertTrue(display is ChargeStatusDisplay.NoData)
        assertEquals("No charge data", display.contentDescription)
    }

    @Test
    fun chargingProjectsGridInMiles() {
        val display = project(state(isCharging = true)) as ChargeStatusDisplay.Charging
        assertEquals("11.00 kW", display.powerText)
        assertEquals("50 mi/h", display.rateText)
        assertEquals("72%", display.batteryText)
        assertEquals("1.5h", display.timeToFullText)
        assertEquals(
            "Charging, Power 11.00 kW, Rate 50 mi/h, Battery 72%, Time to Full 1.5h",
            display.contentDescription,
        )
    }

    @Test
    fun chargingHonorsKilometersUnit() {
        val display = project(state(isCharging = true), prefs(DistanceUnitPref.KM)) as ChargeStatusDisplay.Charging
        assertEquals("80 km/h", display.rateText)
    }

    @Test
    fun chargingHonorsPrecisionSetting() {
        val display = project(state(isCharging = true), prefs(precision = 1)) as ChargeStatusDisplay.Charging
        assertEquals("11.0 kW", display.powerText)
    }

    @Test
    fun chargingShowsEmDashWhenTimeToFullNotPositive() {
        val display = project(state(isCharging = true, timeToFullCharge = 0.0)) as ChargeStatusDisplay.Charging
        assertEquals("\u2014", display.timeToFullText)
    }

    @Test
    fun notChargingProjectsBatteryAndRangeInMiles() {
        val display = project(state(isCharging = false)) as ChargeStatusDisplay.NotCharging
        assertEquals("72%", display.batteryText)
        assertEquals("250 mi", display.rangeText)
        assertEquals("72% \u00b7 250 mi", display.summaryText)
        assertEquals("Not Charging, 72% \u00b7 250 mi", display.contentDescription)
    }

    @Test
    fun notChargingHonorsKilometersUnit() {
        val display = project(state(isCharging = false), prefs(DistanceUnitPref.KM)) as ChargeStatusDisplay.NotCharging
        assertEquals("402 km", display.rangeText)
    }

    @Test
    fun formattersReproduceWebEnUsHalfExpandContract() {
        assertEquals("1,234.5", ChargeStatusProjection.formatNumber(1234.5, decimals = 1))
        // Half-expand (round half away from zero), not Java's default banker's rounding.
        assertEquals("1,235", ChargeStatusProjection.formatInt(1234.5))
        assertEquals("13", ChargeStatusProjection.formatInt(12.5))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("charge-status", ChargeStatusRegistration.ID)
        assertEquals("charging", ChargeStatusRegistration.CATEGORY)
        assertEquals("ChargeStatusWidget", ChargeStatusRegistration.SLUG)
        assertEquals(ChargeStatusSize(cols = 2, rows = 2), ChargeStatusRegistration.defaultSize)
        assertEquals(ChargeStatusSize(cols = 1, rows = 2), ChargeStatusRegistration.minSize)
        assertEquals(ChargeStatusSize(cols = 3, rows = 40), ChargeStatusRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(ChargeStatusSize(cols = 3, rows = 40), ChargeStatusRegistration.clamp(ChargeStatusSize(9, 99)))
        assertEquals(ChargeStatusSize(cols = 1, rows = 2), ChargeStatusRegistration.clamp(ChargeStatusSize(0, 0)))
        assertTrue(ChargeStatusRegistration.isWithinBounds(ChargeStatusSize(2, 2)))
        assertFalse(ChargeStatusRegistration.isWithinBounds(ChargeStatusSize(4, 2)))
    }
}
