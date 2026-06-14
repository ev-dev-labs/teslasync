package io.teslasync.android.dashboard.widgets.weatheratcar

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
 * Off-device verification of the WeatherAtCarWidget's pure logic — the SI→display temperature conversion
 * (the web `fmtInt(convertTempFromSI(…))` whole-degree contract), the `WeatherIcon` condition thresholds
 * (`tempC <= 0` / `>= 25`) read off the RAW SI reading, the `toFixed(2)` coordinate string, the reading /
 * no-data projection branches, the folded TalkBack description, the size compact gate, and the registry
 * metadata. Mirrors the web spec (web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx).
 */
class WeatherAtCarProjectionTest {
    private val strings =
        WeatherAtCarStrings(
            weatherAtCar = "Weather at Car",
            outsideTemperature = "Outside Temperature",
            noWeather = "No weather data",
        )

    private fun prefs(temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    private fun state(
        outsideTemp: Double = 14.0,
        latitude: Double = 37.42,
        longitude: Double = -122.08,
    ): VehicleState =
        VehicleState(
            batteryLevel = 68,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = latitude,
            longitude = longitude,
            odometer = 0.0,
            outsideTemp = outsideTemp,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 5,
        )

    private fun project(
        state: VehicleState?,
        prefs: UnitPref = prefs(),
    ): WeatherAtCarDisplay = WeatherAtCarProjection.project(state, prefs, strings)

    @Test
    fun nullStateProjectsNoData() {
        val display = project(null)
        assertFalse(display.hasData)
        assertEquals("No weather data", display.contentDescription)
        assertEquals(EM_DASH, display.temperatureText)
        assertTrue(WeatherAtCarProjection.isEmptyReading(null))
    }

    @Test
    fun nonFiniteOutsideTempProjectsNoData() {
        assertFalse(project(state(outsideTemp = Double.NaN)).hasData)
        assertFalse(project(state(outsideTemp = Double.POSITIVE_INFINITY)).hasData)
        assertTrue(WeatherAtCarProjection.isEmptyReading(state(outsideTemp = Double.NaN)))
    }

    @Test
    fun readingProjectsCelsiusWithCoordinates() {
        val display = project(state(outsideTemp = 14.0))
        assertTrue(display.hasData)
        assertEquals("14\u00B0C", display.temperatureText)
        assertEquals(WeatherCondition.Mild, display.condition)
        assertEquals("37.42\u00B0, -122.08\u00B0", display.coordinatesText)
        assertEquals("Outside Temperature 14\u00B0C, 37.42\u00B0, -122.08\u00B0", display.contentDescription)
    }

    @Test
    fun readingHonorsFahrenheitUnit() {
        // 14 °C → 57.2 °F → fmtInt → 57; the condition still reads the raw Celsius value (Mild).
        val display = project(state(outsideTemp = 14.0), prefs(TemperatureUnitPref.FAHRENHEIT))
        assertEquals("57\u00B0F", display.temperatureText)
        assertEquals(WeatherCondition.Mild, display.condition)
    }

    @Test
    fun temperatureRoundsToWholeDegrees() {
        // Web `fmtInt` is half-expand: 14.6 → 15.
        assertEquals("15\u00B0C", project(state(outsideTemp = 14.6)).temperatureText)
    }

    @Test
    fun conditionThresholdsMatchWebWeatherIcon() {
        assertEquals(WeatherCondition.Freezing, WeatherAtCarProjection.conditionFor(0.0))
        assertEquals(WeatherCondition.Freezing, WeatherAtCarProjection.conditionFor(-5.0))
        assertEquals(WeatherCondition.Hot, WeatherAtCarProjection.conditionFor(25.0))
        assertEquals(WeatherCondition.Hot, WeatherAtCarProjection.conditionFor(31.5))
        assertEquals(WeatherCondition.Mild, WeatherAtCarProjection.conditionFor(0.1))
        assertEquals(WeatherCondition.Mild, WeatherAtCarProjection.conditionFor(24.9))
    }

    @Test
    fun coordinatesReproduceToFixedTwo() {
        assertEquals("37.43\u00B0, -122.08\u00B0", WeatherAtCarProjection.formatCoordinates(37.426, -122.083))
        assertEquals("0.00\u00B0, 0.00\u00B0", WeatherAtCarProjection.formatCoordinates(0.0, 0.0))
        assertEquals("-1.50\u00B0, 2.50\u00B0", WeatherAtCarProjection.formatCoordinates(-1.5, 2.5))
    }

    @Test
    fun sizeReportsCompactOnlyForSingleCell() {
        assertTrue(WeatherAtCarSize(cols = 1, rows = 1).isCompact)
        assertFalse(WeatherAtCarSize(cols = 1, rows = 2).isCompact)
        assertFalse(WeatherAtCarSize(cols = 2, rows = 1).isCompact)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("weather-at-car", WeatherAtCarRegistration.ID)
        assertEquals("climate", WeatherAtCarRegistration.CATEGORY)
        assertEquals("WeatherAtCarWidget", WeatherAtCarRegistration.SLUG)
        assertEquals(WeatherAtCarSize(cols = 1, rows = 2), WeatherAtCarRegistration.DEFAULT_SIZE)
        assertEquals(WeatherAtCarSize(cols = 1, rows = 2), WeatherAtCarRegistration.MIN_SIZE)
        assertEquals(WeatherAtCarSize(cols = 3, rows = 40), WeatherAtCarRegistration.MAX_SIZE)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(WeatherAtCarSize(cols = 3, rows = 40), WeatherAtCarRegistration.clamp(WeatherAtCarSize(9, 99)))
        assertEquals(WeatherAtCarSize(cols = 1, rows = 2), WeatherAtCarRegistration.clamp(WeatherAtCarSize(0, 0)))
        assertTrue(WeatherAtCarRegistration.isWithinBounds(WeatherAtCarSize(1, 2)))
        assertTrue(WeatherAtCarRegistration.isWithinBounds(WeatherAtCarSize(3, 40)))
        assertFalse(WeatherAtCarRegistration.isWithinBounds(WeatherAtCarSize(4, 2)))
    }
}
