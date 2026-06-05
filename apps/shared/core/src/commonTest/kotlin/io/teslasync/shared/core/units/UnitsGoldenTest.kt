package io.teslasync.shared.core.units

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.abs
import kotlin.math.max
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Verifies the Kotlin SI converters/formatters against the golden vectors that
 * were derived from the web source of truth (web/src/lib/unitConversion.ts).
 * KMP and the future C# port must both reproduce the web truth row-for-row.
 */
class UnitsGoldenTest {
    @Serializable
    private data class GoldenPref(
        val distance: String,
        val speed: String,
        val temperature: String,
        val pressure: String,
        val energy: String,
        val duration: String,
        val power: String,
        val locale: String? = null,
        val precision: Int? = null,
        val emptyDisplay: String? = null,
    )

    @Serializable
    private data class GoldenOptions(
        val precision: Int? = null,
    )

    @Serializable
    private data class GoldenRow(
        val fn: String,
        val formatter: String,
        val quantity: String,
        val system: String,
        @SerialName("input_si") val inputSi: Double? = null,
        val preference: GoldenPref,
        val options: GoldenOptions? = null,
        @SerialName("expected_value") val expectedValue: Double? = null,
        @SerialName("expected_formatted") val expectedFormatted: String,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun rows(): List<GoldenRow> = json.decodeFromString<List<GoldenRow>>(readUnitsGoldenJson())

    private fun GoldenPref.toPref(): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.fromLabel(distance),
            speed = SpeedUnitPref.fromLabel(speed),
            temperature = TemperatureUnitPref.fromLabel(temperature),
            pressure = PressureUnitPref.fromLabel(pressure),
            energy = EnergyUnitPref.fromLabel(energy),
            duration = DurationUnitPref.fromLabel(duration),
            power = PowerUnitPref.fromLabel(power),
            locale = locale,
            precision = precision,
            emptyDisplay = emptyDisplay,
        )

    private fun convert(
        row: GoldenRow,
        input: Double,
    ): Double {
        val p = row.preference
        return when (row.formatter) {
            "formatDistance" -> convertDistanceFromSI(input, DistanceUnitPref.fromLabel(p.distance))
            "formatSpeed" -> convertSpeedFromSI(input, SpeedUnitPref.fromLabel(p.speed))
            "formatTemperature" -> convertTempFromSI(input, TemperatureUnitPref.fromLabel(p.temperature))
            "formatPressure" -> convertPressureFromSI(input, PressureUnitPref.fromLabel(p.pressure))
            "formatEnergy" -> convertEnergyFromSI(input, EnergyUnitPref.fromLabel(p.energy))
            "formatDuration" -> convertDurationFromSI(input, DurationUnitPref.fromLabel(p.duration))
            "formatPower" -> convertPowerFromSI(input, PowerUnitPref.fromLabel(p.power))
            else -> error("unknown formatter ${row.formatter}")
        }
    }

    private fun format(row: GoldenRow): String {
        val pref = row.preference.toPref()
        val precision = row.options?.precision
        return when (row.formatter) {
            "formatDistance" -> formatDistance(row.inputSi, pref, precision)
            "formatSpeed" -> formatSpeed(row.inputSi, pref, precision)
            "formatTemperature" -> formatTemperature(row.inputSi, pref, precision)
            "formatPressure" -> formatPressure(row.inputSi, pref, precision)
            "formatEnergy" -> formatEnergy(row.inputSi, pref, precision)
            "formatDuration" -> formatDuration(row.inputSi, pref, precision)
            "formatPower" -> formatPower(row.inputSi, pref, precision)
            else -> error("unknown formatter ${row.formatter}")
        }
    }

    @Test
    fun goldenFileParsesAndIsNonEmpty() {
        val all = rows()
        assertTrue(all.size >= 40, "golden fixture should be comprehensive, got ${all.size}")
    }

    @Test
    fun everyGoldenRowMatchesConverterAndFormatter() {
        for (row in rows()) {
            val input = row.inputSi
            if (input != null && input.isFinite() && row.expectedValue != null) {
                val actual = convert(row, input)
                val expected = row.expectedValue
                val tol = 1e-9 * max(1.0, abs(expected))
                assertTrue(
                    abs(actual - expected) <= tol,
                    "${row.fn}($input) expected $expected but got $actual",
                )
            }
            assertEquals(
                row.expectedFormatted,
                format(row),
                "${row.formatter}($input) system=${row.system} formatted mismatch",
            )
        }
    }

    @Test
    fun everyConverterFnHasMetricAndImperialCoverage() {
        val bySystem = rows().groupBy { it.fn }
        val expectedFns =
            setOf(
                "convertDistanceFromSI",
                "convertSpeedFromSI",
                "convertTempFromSI",
                "convertPressureFromSI",
                "convertEnergyFromSI",
                "convertDurationFromSI",
                "convertPowerFromSI",
            )
        assertEquals(expectedFns, bySystem.keys, "golden must cover all 7 converter fns")
        for ((fn, rows) in bySystem) {
            val systems = rows.map { it.system }.toSet()
            assertTrue("metric" in systems, "$fn missing a metric golden row")
            assertTrue("imperial" in systems, "$fn missing an imperial golden row")
        }
    }
}
