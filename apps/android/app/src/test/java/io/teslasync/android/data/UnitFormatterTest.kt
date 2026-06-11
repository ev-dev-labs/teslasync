package io.teslasync.android.data

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Tests the SI display boundary: [UnitPreferences.fromSettings] derivation (mirroring web `useUnits`)
 * and that [UnitFormatter] converts SI inputs to the chosen display unit at the boundary — proving SI
 * is the input contract and is never stored converted.
 */
class UnitFormatterTest {
    private fun settings(vararg pairs: Pair<String, JsonElement>): JsonObject = JsonObject(pairs.toMap())

    @Test
    fun defaultsAreMetric() {
        val prefs = UnitPreferences.fromSettings(null)

        assertEquals(DistanceUnitPref.KM, prefs.distance)
        assertEquals(SpeedUnitPref.KMH, prefs.speed)
        assertEquals(TemperatureUnitPref.CELSIUS, prefs.temperature)
        assertEquals(PressureUnitPref.BAR, prefs.pressure)
        assertEquals(EnergyUnitPref.KWH, prefs.energy)
        assertEquals("en-US", prefs.locale)
        assertNull(prefs.precision)
    }

    @Test
    fun imperialDerivationMirrorsWebUseUnits() {
        val prefs =
            UnitPreferences.fromSettings(
                settings(
                    "unit_of_length" to JsonPrimitive("mi"),
                    "unit_of_temp" to JsonPrimitive("F"),
                    "unit_of_pressure" to JsonPrimitive("psi"),
                    "locale" to JsonPrimitive("en-GB"),
                    "decimal_precision" to JsonPrimitive(2),
                ),
            )

        assertEquals(DistanceUnitPref.MI, prefs.distance)
        assertEquals(SpeedUnitPref.MPH, prefs.speed)
        assertEquals(TemperatureUnitPref.FAHRENHEIT, prefs.temperature)
        assertEquals(PressureUnitPref.PSI, prefs.pressure)
        assertEquals("en-GB", prefs.locale)
        assertEquals(2, prefs.precision)
    }

    @Test
    fun blankLocaleFallsBackToDefault() {
        assertEquals("en-US", UnitPreferences.fromSettings(settings("locale" to JsonPrimitive("   "))).locale)
    }

    @Test
    fun negativePrecisionIsIgnored() {
        assertNull(UnitPreferences.fromSettings(settings("decimal_precision" to JsonPrimitive(-1))).precision)
    }

    @Test
    fun convertsSiMetersToTheChosenDisplayUnit() {
        val imperial = UnitFormatter(UnitPreferences.fromSettings(settings("unit_of_length" to JsonPrimitive("mi"))))
        val metric = UnitFormatter.default()

        // 1609.344 m is exactly 1 mile; metric default keeps km at precision 1.
        assertEquals("1.0 mi", imperial.distance(1609.344))
        assertEquals("1.6 km", metric.distance(1609.344))
    }

    @Test
    fun nullOrNonFiniteSiValueFormatsAsEmDash() {
        assertEquals("\u2014", UnitFormatter.default().distance(null))
        assertEquals("\u2014", UnitFormatter.default().speed(Double.NaN))
    }
}
