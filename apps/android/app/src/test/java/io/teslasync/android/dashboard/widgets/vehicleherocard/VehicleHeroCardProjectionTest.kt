package io.teslasync.android.dashboard.widgets.vehicleherocard

import io.teslasync.shared.core.api.generated.Vehicle
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the VehicleHeroCardWidget's pure logic — the SI→display unit conversion
 * (range in meters, temps in °C), the web `?? 0 / ?? false / ?? 'offline'` defaults, the battery health
 * band, the model/trim subtitle, the charge-power figure, the TalkBack content descriptions, the
 * footprint flags (compact / wide / tall), and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx + registry/vehicle.ts).
 */
class VehicleHeroCardProjectionTest {
    private val strings =
        VehicleHeroCardStrings(
            battery = "Battery",
            range = "Range",
            cabin = "Cabin",
            outside = "Outside",
            charging = "Charging",
            idealRange = "Ideal Range",
        )

    private fun prefs(
        distance: DistanceUnitPref = DistanceUnitPref.MI,
        temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
    ): UnitPref =
        UnitPref(
            distance = distance,
            speed = if (distance == DistanceUnitPref.MI) SpeedUnitPref.MPH else SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    // SI inputs chosen to land on round display values: idealRange 402336 m = 250 mi = 402.336 km;
    // insideTemp 21 °C = 69.8 °F; outsideTemp 9 °C = 48.2 °F; chargerPower 11 kW; battery 72%.
    private fun state(
        isCharging: Boolean = false,
        batteryLevel: Long = 72,
        chargerPower: Double = 11.0,
        insideTemp: Double = 21.0,
        outsideTemp: Double = 9.0,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = chargerPower,
            idealRange = 402_336.0,
            insideTemp = insideTemp,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = outsideTemp,
            power = 0.0,
            ratedRange = 402_336.0,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 5,
        )

    private fun vehicle(
        displayName: String = "Garage Car",
        vin: String = "5YJ3E1EA",
        model: String? = "Model 3",
        trimLevel: String? = "Long Range",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = displayName,
            enrolledAt = Instant.fromEpochSeconds(0),
            id = 5,
            teslaId = 5,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = vin,
            model = model,
            trimLevel = trimLevel,
        )

    @Test
    fun chargingStateProjectsHeroInMiles() {
        val display = VehicleHeroCardProjection.project(vehicle(), state(isCharging = true), prefs(), strings)
        assertEquals("Garage Car", display.name)
        assertEquals("Model 3 Long Range", display.subtitle)
        assertEquals("online", display.status)
        assertEquals(72, display.batteryLevel)
        assertEquals("72%", display.batteryText)
        assertEquals(BatteryTier.High, display.batteryTier)
        assertEquals("250 mi", display.rangeText)
        assertEquals("21\u00B0C", display.cabinText)
        assertEquals("9\u00B0C", display.outsideText)
        assertTrue(display.isCharging)
        assertEquals("11.0 kW", display.chargerPowerText)
    }

    @Test
    fun honorsKilometersAndFahrenheit() {
        val display =
            VehicleHeroCardProjection.project(
                vehicle(),
                state(),
                prefs(distance = DistanceUnitPref.KM, temperature = TemperatureUnitPref.FAHRENHEIT),
                strings,
            )
        assertEquals("402 km", display.rangeText)
        assertEquals("70\u00B0F", display.cabinText)
        assertEquals("48\u00B0F", display.outsideText)
    }

    @Test
    fun negativeTemperaturesRoundTowardPositiveLikeWebMathRound() {
        // Web renders Math.round(convertTempFromSI(...)) — halves round toward +∞ (-2.5 -> -2, -0.5 -> 0),
        // not half-away-from-zero. Realistic for sub-zero winter readings reported in 0.5° steps.
        val display = VehicleHeroCardProjection.project(vehicle(), state(insideTemp = -2.5, outsideTemp = -0.5), prefs(), strings)
        assertEquals("-2\u00B0C", display.cabinText)
        assertEquals("0\u00B0C", display.outsideText)
    }

    @Test
    fun nullStateRendersOfflineFallbackCard() {
        val display = VehicleHeroCardProjection.project(vehicle(), null, prefs(), strings)
        assertEquals("offline", display.status)
        assertNull(display.batteryLevel)
        assertEquals("\u2014", display.batteryText)
        assertEquals(BatteryTier.Unknown, display.batteryTier)
        assertEquals("\u2014", display.rangeText)
        assertEquals("\u2014", display.cabinText)
        assertEquals("\u2014", display.outsideText)
        assertFalse(display.isCharging)
        assertNull(display.chargerPowerText)
    }

    @Test
    fun batteryTierFollowsWebThresholds() {
        assertEquals(BatteryTier.High, tierFor(51))
        assertEquals(BatteryTier.Mid, tierFor(50))
        assertEquals(BatteryTier.Mid, tierFor(21))
        assertEquals(BatteryTier.Low, tierFor(20))
        assertEquals(BatteryTier.Low, tierFor(0))
    }

    @Test
    fun chargerPowerHiddenWhenNotChargingOrZero() {
        assertNull(VehicleHeroCardProjection.project(vehicle(), state(isCharging = false), prefs(), strings).chargerPowerText)
        assertNull(
            VehicleHeroCardProjection
                .project(vehicle(), state(isCharging = true, chargerPower = 0.0), prefs(), strings)
                .chargerPowerText,
        )
    }

    @Test
    fun chargerPowerRoundsShortestDecimalHalfUpLikeWebFmtNumber() {
        // Web fmtNumber(48.05, 1) == "48.1": round the shortest decimal, not the raw binary double
        // (a naive HALF_UP on the double would yield "48.0").
        val display = VehicleHeroCardProjection.project(vehicle(), state(isCharging = true, chargerPower = 48.05), prefs(), strings)
        assertEquals("48.1 kW", display.chargerPowerText)
    }

    @Test
    fun subtitleFoldsModelAndTrim() {
        assertEquals("Model 3 Long Range", subtitleFor(model = "Model 3", trim = "Long Range"))
        assertEquals("Model Y", subtitleFor(model = "Model Y", trim = null))
        assertEquals("Performance", subtitleFor(model = null, trim = "Performance"))
        assertEquals("", subtitleFor(model = null, trim = null))
    }

    @Test
    fun nameFallsBackToVinWhenDisplayNameBlank() {
        val display = VehicleHeroCardProjection.project(vehicle(displayName = "  ", vin = "VIN123"), state(), prefs(), strings)
        assertEquals("VIN123", display.name)
    }

    @Test
    fun fullDescriptionFoldsEveryVisibleMetric() {
        val display = VehicleHeroCardProjection.project(vehicle(), state(isCharging = true), prefs(), strings)
        val description = display.fullDescription
        assertTrue(description.contains("Garage Car"))
        assertTrue(description.contains("online"))
        assertTrue(description.contains("Battery 72%"))
        assertTrue(description.contains("Range 250 mi"))
        assertTrue(description.contains("Cabin 21\u00B0C"))
        assertTrue(description.contains("Outside 9\u00B0C"))
        assertTrue(description.contains("Charging 11.0 kW"))
    }

    @Test
    fun compactDescriptionCarriesStatusAndBattery() {
        val display = VehicleHeroCardProjection.project(vehicle(), state(), prefs(), strings)
        assertEquals("Garage Car, online, Battery 72%", display.compactDescription)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("vehicle-hero-card", VehicleHeroCardRegistration.ID)
        assertEquals("vehicle", VehicleHeroCardRegistration.CATEGORY)
        assertEquals("VehicleHeroCardWidget", VehicleHeroCardRegistration.SLUG)
        assertEquals(VehicleHeroCardSize(cols = 2, rows = 2), VehicleHeroCardRegistration.defaultSize)
        assertEquals(VehicleHeroCardSize(cols = 1, rows = 2), VehicleHeroCardRegistration.minSize)
        assertEquals(VehicleHeroCardSize(cols = 4, rows = 40), VehicleHeroCardRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(VehicleHeroCardSize(cols = 4, rows = 40), VehicleHeroCardRegistration.clamp(VehicleHeroCardSize(9, 99)))
        assertEquals(VehicleHeroCardSize(cols = 1, rows = 2), VehicleHeroCardRegistration.clamp(VehicleHeroCardSize(0, 0)))
        assertTrue(VehicleHeroCardRegistration.isWithinBounds(VehicleHeroCardSize(2, 2)))
        assertFalse(VehicleHeroCardRegistration.isWithinBounds(VehicleHeroCardSize(5, 2)))
    }

    @Test
    fun footprintFlagsMatchWeb() {
        assertTrue(VehicleHeroCardSize(1, 1).isCompact)
        assertFalse(VehicleHeroCardSize(1, 2).isCompact)
        assertFalse(VehicleHeroCardSize(2, 2).isCompact)
        assertTrue(VehicleHeroCardSize(3, 2).isWide)
        assertFalse(VehicleHeroCardSize(2, 2).isWide)
        assertTrue(VehicleHeroCardSize(2, 2).isTall)
        assertFalse(VehicleHeroCardSize(2, 1).isTall)
    }

    private fun tierFor(level: Long): BatteryTier =
        VehicleHeroCardProjection.project(vehicle(), state(batteryLevel = level), prefs(), strings).batteryTier

    private fun subtitleFor(
        model: String?,
        trim: String?,
    ): String = VehicleHeroCardProjection.project(vehicle(model = model, trimLevel = trim), state(), prefs(), strings).subtitle
}
