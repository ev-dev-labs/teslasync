package io.teslasync.shared.core.units

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Direct edge-case coverage for the SI formatters that complements the golden
 * vectors: non-finite inputs, the em-dash fallback, custom emptyDisplay, the
 * default per-quantity precision, and negative-zero sign preservation.
 */
class UnitsFormatterTest {
    private val metric =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.WH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.W,
            locale = "en-US",
        )

    @Test
    fun nullAndNonFiniteYieldFallback() {
        assertEquals("\u2014", formatDistance(null, metric))
        assertEquals("\u2014", formatSpeed(Double.NaN, metric))
        assertEquals("\u2014", formatPower(Double.POSITIVE_INFINITY, metric))
        assertEquals("\u2014", formatEnergy(Double.NEGATIVE_INFINITY, metric))
    }

    @Test
    fun emptyDisplayOverrideIsHonoured() {
        assertEquals("N/A", formatPressure(null, metric.copy(emptyDisplay = "N/A")))
    }

    @Test
    fun defaultPrecisionPerQuantity() {
        // distance default = 1, energy default = 2, duration default = 0.
        assertEquals("1.0 km", formatDistance(1000.0, metric))
        assertEquals("1.50 kWh", formatEnergy(1500.0, metric.copy(energy = EnergyUnitPref.KWH)))
        assertEquals("2 h", formatDuration(7200.0, metric))
    }

    @Test
    fun perCallPrecisionOverridesDefault() {
        assertEquals("1.000 km", formatDistance(1000.0, metric, precision = 3))
    }

    @Test
    fun prefPrecisionUsedWhenNoOverride() {
        assertEquals("1.000 km", formatDistance(1000.0, metric.copy(precision = 3)))
    }

    @Test
    fun negativeRoundingToZeroKeepsSign() {
        // -0.04 kPa at the default pressure precision (1) rounds to -0.0.
        assertEquals("-0.0 kPa", formatPressure(-0.04, metric))
    }

    @Test
    fun thousandsGroupingMatchesEnUs() {
        assertEquals("1,000,000 W", formatPower(1_000_000.0, metric, precision = 0))
    }

    @Test
    fun temperatureHasNoSpaceBeforeUnit() {
        assertEquals("22.5\u00B0C", formatTemperature(22.5, metric))
    }
}
