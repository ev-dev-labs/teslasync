package io.teslasync.android.featureviews.temperaturegauges

import io.teslasync.shared.core.units.TemperatureUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the TemperatureGauges pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx): the
 * `convertTempFromSI` value + axis conversion, the `[0, max]` clamp, the `tempSeverityColor` severity accent,
 * the `Number.isInteger`-or-precision decimals rule, and the `fmtNumber(..., 0) + unit` "Max" caption. Because
 * the surface is presentational, each [TemperatureGaugesDisplay] is exactly what the thin composable renders,
 * so these assertions double as the per-state adapter "snapshot".
 */
class TemperatureGaugesProjectionTest {
    private val celsius = TemperatureUnitPref.CELSIUS
    private val fahrenheit = TemperatureUnitPref.FAHRENHEIT
    private val delta = 1e-9

    private fun sensor(
        label: String = "Front Motor",
        valueC: Double? = 90.0,
        maxTempC: Double = 150.0,
    ) = TempSensorInput(label = label, valueC = valueC, maxTempC = maxTempC)

    private fun projectOne(
        sensor: TempSensorInput,
        tempUnit: TemperatureUnitPref = celsius,
        precision: Int = DEFAULT_PRECISION,
        locale: Locale = Locale.US,
    ): TempGauge =
        TemperatureGaugesProjection
            .project(listOf(sensor), loading = false, tempUnit = tempUnit, precision = precision, locale = locale)
            .gauges
            .single()

    // ── severity(): web `tempSeverityColor` ──────────────────────────────────────

    @Test
    fun severityIsUnknownForANullReading() {
        // web `if (celsius === null) return '#6b7280'` (grey) -> the neutral "unknown" accent.
        assertEquals(TempGaugeAccent.Unknown, TemperatureGaugesProjection.severity(null, 150.0))
    }

    @Test
    fun severityCriticalAtOrAboveEightyFivePercent() {
        assertEquals(TempGaugeAccent.Critical, TemperatureGaugesProjection.severity(127.5, 150.0)) // ratio 0.85
        assertEquals(TempGaugeAccent.Critical, TemperatureGaugesProjection.severity(150.0, 150.0)) // ratio 1.0
    }

    @Test
    fun severityWarningBetweenSixtyFiveAndEightyFivePercent() {
        assertEquals(TempGaugeAccent.Warning, TemperatureGaugesProjection.severity(97.5, 150.0)) // ratio 0.65
        assertEquals(TempGaugeAccent.Warning, TemperatureGaugesProjection.severity(120.0, 150.0)) // ratio 0.80
    }

    @Test
    fun severityGoodBelowSixtyFivePercent() {
        assertEquals(TempGaugeAccent.Good, TemperatureGaugesProjection.severity(90.0, 150.0)) // ratio 0.60
        assertEquals(TempGaugeAccent.Good, TemperatureGaugesProjection.severity(0.0, 150.0)) // ratio 0.0
    }

    @Test
    fun severityRatioUsesSiValuesNotDisplayUnits() {
        // The ratio is computed on SI Celsius, so the accent is identical regardless of the display unit.
        val hot = sensor(valueC = 110.0, maxTempC = 120.0) // ratio 0.916 -> Critical
        assertEquals(TempGaugeAccent.Critical, projectOne(hot, tempUnit = celsius).accent)
        assertEquals(TempGaugeAccent.Critical, projectOne(hot, tempUnit = fahrenheit).accent)
    }

    // ── value conversion + clamp: web `value!=null ? toTemperatureDisplay(value) : 0`, then `[0, max]` ──

    @Test
    fun valueConvertsFromSiCelsiusToCelsiusUnchanged() {
        val gauge = projectOne(sensor(valueC = 92.0, maxTempC = 150.0), tempUnit = celsius)
        assertEquals(92.0, gauge.value, delta)
        assertEquals(150.0, gauge.max, delta)
        assertEquals("\u00B0C", gauge.unit)
    }

    @Test
    fun valueConvertsFromSiCelsiusToFahrenheit() {
        // 100°C -> 212°F, ceiling 150°C -> 302°F.
        val gauge = projectOne(sensor(valueC = 100.0, maxTempC = 150.0), tempUnit = fahrenheit)
        assertEquals(212.0, gauge.value, delta)
        assertEquals(302.0, gauge.max, delta)
        assertEquals("\u00B0F", gauge.unit)
    }

    @Test
    fun valueClampsAboveTheAxisMaximum() {
        // web RadialGauge `Math.max(0, Math.min(value, max))`: 200°C over a 150°C ceiling renders at 150.
        val gauge = projectOne(sensor(valueC = 200.0, maxTempC = 150.0), tempUnit = celsius)
        assertEquals(150.0, gauge.value, delta)
    }

    @Test
    fun valueClampsBelowZero() {
        // A sub-zero reading renders at 0 (the gauge has no negative track).
        val gauge = projectOne(sensor(valueC = -10.0, maxTempC = 150.0), tempUnit = celsius)
        assertEquals(0.0, gauge.value, delta)
    }

    @Test
    fun nullReadingRendersZeroValueAndUnknownAccent() {
        // web `sensor.value !== null ? toTemperatureDisplay(...) : 0` -> 0 with the grey/unknown accent.
        val gauge = projectOne(sensor(valueC = null, maxTempC = 60.0), tempUnit = celsius)
        assertEquals(0.0, gauge.value, delta)
        assertEquals(TempGaugeAccent.Unknown, gauge.accent)
        assertEquals(0, gauge.decimals)
    }

    // ── decimals: web `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())` ──

    @Test
    fun decimalsAreZeroWhenTheClampedValueIsWhole() {
        assertEquals(0, projectOne(sensor(valueC = 92.0), tempUnit = celsius).decimals) // 92 is whole
    }

    @Test
    fun decimalsUseGlobalPrecisionWhenTheClampedValueIsFractional() {
        // 92°C -> 197.6°F is fractional, so it renders at the user precision.
        assertEquals(DEFAULT_PRECISION, projectOne(sensor(valueC = 92.0), tempUnit = fahrenheit).decimals)
        assertEquals(3, projectOne(sensor(valueC = 92.0), tempUnit = fahrenheit, precision = 3).decimals)
    }

    @Test
    fun decimalsForFollowsTheWebRule() {
        assertEquals(0, TemperatureGaugesProjection.decimalsFor(150.0, 2))
        assertEquals(2, TemperatureGaugesProjection.decimalsFor(197.6, 2))
    }

    // ── "Max" caption value: web `fmtNumber(toTemperatureDisplay(maxTemp), 0)` + unit ──

    @Test
    fun maxValueLabelIsWholeDegreesWithUnitInCelsius() {
        assertEquals("150\u00B0C", projectOne(sensor(maxTempC = 150.0), tempUnit = celsius).maxValueLabel)
        assertEquals("60\u00B0C", projectOne(sensor(maxTempC = 60.0), tempUnit = celsius).maxValueLabel)
    }

    @Test
    fun maxValueLabelConvertsAndRoundsToWholeDegreesInFahrenheit() {
        // 150°C -> 302°F, 60°C -> 140°F.
        assertEquals("302\u00B0F", projectOne(sensor(maxTempC = 150.0), tempUnit = fahrenheit).maxValueLabel)
        assertEquals("140\u00B0F", projectOne(sensor(maxTempC = 60.0), tempUnit = fahrenheit).maxValueLabel)
    }

    @Test
    fun formatWholeGroupsThousandsAndNormalizesNegativeZero() {
        assertEquals("1,500", TemperatureGaugesProjection.formatWhole(1500.0, Locale.US))
        assertEquals("0", TemperatureGaugesProjection.formatWhole(-0.0, Locale.US))
    }

    // ── project(): per-state snapshots + ordering + label (a11y) presence ──

    @Test
    fun projectResolvedKeepsSensorOrderAndLabels() {
        val sensors =
            listOf(
                sensor(label = "Front Motor", valueC = 92.0, maxTempC = 150.0),
                sensor(label = "Rear Motor", valueC = 105.0, maxTempC = 150.0),
                sensor(label = "Inverter", valueC = 108.0, maxTempC = 120.0),
                sensor(label = "Battery", valueC = null, maxTempC = 60.0),
            )

        val display =
            TemperatureGaugesProjection.project(
                sensors = sensors,
                loading = false,
                tempUnit = celsius,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        assertFalse(display.loading)
        assertTrue(display.hasData)
        assertEquals(listOf("Front Motor", "Rear Motor", "Inverter", "Battery"), display.gauges.map { it.label })
        // The four sensors exercise all four accents in web order.
        assertEquals(
            listOf(
                TempGaugeAccent.Good, // 92/150 = 0.61
                TempGaugeAccent.Warning, // 105/150 = 0.70
                TempGaugeAccent.Critical, // 108/120 = 0.90
                TempGaugeAccent.Unknown, // null
            ),
            display.gauges.map { it.accent },
        )
    }

    @Test
    fun projectEveryGaugeCarriesANonBlankLabelForAccessibility() {
        val sensors = listOf(sensor(label = "Front Motor"), sensor(label = "Battery", valueC = null, maxTempC = 60.0))

        val display =
            TemperatureGaugesProjection.project(
                sensors = sensors,
                loading = false,
                tempUnit = celsius,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        assertTrue(display.gauges.isNotEmpty())
        assertTrue(display.gauges.all { it.label.isNotBlank() })
        assertTrue(display.gauges.all { it.maxValueLabel.isNotBlank() })
    }

    @Test
    fun projectEmptySensorsHasNoDataAndNoGauges() {
        val display =
            TemperatureGaugesProjection.project(
                sensors = emptyList(),
                loading = false,
                tempUnit = celsius,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        assertFalse(display.hasData)
        assertTrue(display.gauges.isEmpty())
    }

    @Test
    fun projectThreadsLoadingFlag() {
        val display =
            TemperatureGaugesProjection.project(
                sensors = emptyList(),
                loading = true,
                tempUnit = celsius,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        assertTrue(display.loading)
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
        assertEquals(Locale.US, resolveDisplayLocale("en-US"))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }
}
