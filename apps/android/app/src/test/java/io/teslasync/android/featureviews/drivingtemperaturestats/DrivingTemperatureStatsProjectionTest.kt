package io.teslasync.android.featureviews.drivingtemperaturestats

import io.teslasync.shared.core.units.TemperatureUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the DrivingTemperatureStats pure logic — the native mirror of every derivation
 * the web component performs (web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx):
 * the `safe()` coercion, the `convertTempFromSI` display conversion, the `fmtNumber(value, 1)` formatting,
 * the `insideTemp || outsideTemp` presence test, and the per-side `data ? … : '—'` dash. Because the surface
 * is presentational, each [DrivingTemperatureStatsDisplay] is exactly what the thin composable renders, so
 * these assertions double as the per-state adapter "snapshot".
 */
class DrivingTemperatureStatsProjectionTest {
    private val celsius = TemperatureUnitPref.CELSIUS
    private val fahrenheit = TemperatureUnitPref.FAHRENHEIT

    // ── safe(): web `safe(v) = typeof v === 'number' && isFinite(v) ? v : 0` ──────

    @Test
    fun safeReturnsFiniteValuesUnchanged() {
        assertEquals(21.0, DrivingTemperatureStatsProjection.safe(21.0), 0.0)
        assertEquals(-5.5, DrivingTemperatureStatsProjection.safe(-5.5), 0.0)
        assertEquals(0.0, DrivingTemperatureStatsProjection.safe(0.0), 0.0)
    }

    @Test
    fun safeCoercesNullAndNonFiniteToZero() {
        assertEquals(0.0, DrivingTemperatureStatsProjection.safe(null), 0.0)
        assertEquals(0.0, DrivingTemperatureStatsProjection.safe(Double.NaN), 0.0)
        assertEquals(0.0, DrivingTemperatureStatsProjection.safe(Double.POSITIVE_INFINITY), 0.0)
        assertEquals(0.0, DrivingTemperatureStatsProjection.safe(Double.NEGATIVE_INFINITY), 0.0)
    }

    // ── formatOneDecimal(): web `fmtNumber(value, 1)` ────────────────────────────

    @Test
    fun formatOneDecimalAlwaysShowsOneFractionDigit() {
        assertEquals("21.0", DrivingTemperatureStatsProjection.formatOneDecimal(21.0, Locale.US))
        assertEquals("9.1", DrivingTemperatureStatsProjection.formatOneDecimal(9.1, Locale.US))
    }

    @Test
    fun formatOneDecimalRoundsHalfAwayFromZero() {
        // ECMAScript Intl default "halfExpand": 18.25 -> "18.3", and the negative magnitude rounds away too.
        assertEquals("18.3", DrivingTemperatureStatsProjection.formatOneDecimal(18.25, Locale.US))
        assertEquals("-2.3", DrivingTemperatureStatsProjection.formatOneDecimal(-2.25, Locale.US))
    }

    @Test
    fun formatOneDecimalGroupsThousandsLikeToLocaleString() {
        assertEquals("1,234.5", DrivingTemperatureStatsProjection.formatOneDecimal(1234.5, Locale.US))
    }

    @Test
    fun formatOneDecimalNormalizesNegativeZero() {
        // A converted `-0.0` renders "0.0" (not "-0.0"), matching Intl.NumberFormat.
        assertEquals("0.0", DrivingTemperatureStatsProjection.formatOneDecimal(-0.0, Locale.US))
    }

    // ── project(): per-state ─────────────────────────────────────────────────────

    @Test
    fun projectBothReadingsPresentFormatsEveryCardInCelsius() {
        val display =
            DrivingTemperatureStatsProjection.project(
                temperature =
                    DrivingTemperature(
                        inside = TempRange(min = 18.0, avg = 21.0, max = 24.0),
                        outside = TempRange(min = 9.0, avg = 14.5, max = 22.0),
                    ),
                loading = false,
                tempUnit = celsius,
                locale = Locale.US,
            )

        assertFalse(display.loading)
        assertTrue(display.hasData)
        assertEquals("\u00B0C", display.unitLabel)
        assertEquals("18.0", display.insideMin)
        assertEquals("21.0", display.insideAvg)
        assertEquals("24.0", display.insideMax)
        assertEquals("9.0", display.outsideMin)
        assertEquals("14.5", display.outsideAvg)
        assertEquals("22.0", display.outsideMax)
    }

    @Test
    fun projectFahrenheitConvertsFromSiAndLabelsUnit() {
        val display =
            DrivingTemperatureStatsProjection.project(
                temperature =
                    DrivingTemperature(
                        inside = TempRange(min = 0.0, avg = 20.0, max = 37.0),
                        outside = null,
                    ),
                loading = false,
                tempUnit = fahrenheit,
                locale = Locale.US,
            )

        assertEquals("\u00B0F", display.unitLabel)
        // 0°C -> 32°F, 20°C -> 68°F, 37°C -> 98.6°F.
        assertEquals("32.0", display.insideMin)
        assertEquals("68.0", display.insideAvg)
        assertEquals("98.6", display.insideMax)
    }

    @Test
    fun projectAbsentSideRendersDashForThatSideOnly() {
        val display =
            DrivingTemperatureStatsProjection.project(
                temperature =
                    DrivingTemperature(
                        inside = TempRange(min = 18.0, avg = 21.0, max = 24.0),
                        outside = null,
                    ),
                loading = false,
                tempUnit = celsius,
                locale = Locale.US,
            )

        assertTrue(display.hasData)
        assertEquals("18.0", display.insideMin)
        assertEquals(EM_DASH, display.outsideMin)
        assertEquals(EM_DASH, display.outsideAvg)
        assertEquals(EM_DASH, display.outsideMax)
    }

    @Test
    fun projectPresentReadingWithNullFieldRendersZeroNotDash() {
        // Web nuance: when the reading object exists but a single statistic is missing, `safe()` coerces it
        // to 0 and the card shows "0.0" — only a wholly-absent side renders the em-dash.
        val display =
            DrivingTemperatureStatsProjection.project(
                temperature =
                    DrivingTemperature(
                        inside = TempRange(min = null, avg = 21.0, max = null),
                        outside = null,
                    ),
                loading = false,
                tempUnit = celsius,
                locale = Locale.US,
            )

        assertEquals("0.0", display.insideMin)
        assertEquals("21.0", display.insideAvg)
        assertEquals("0.0", display.insideMax)
    }

    @Test
    fun projectNullTemperatureHasNoDataAndAllDashes() {
        val display =
            DrivingTemperatureStatsProjection.project(
                temperature = null,
                loading = false,
                tempUnit = celsius,
                locale = Locale.US,
            )

        assertFalse(display.hasData)
        listOf(
            display.insideMin,
            display.insideAvg,
            display.insideMax,
            display.outsideMin,
            display.outsideAvg,
            display.outsideMax,
        ).forEach { assertEquals(EM_DASH, it) }
    }

    @Test
    fun projectEmptyTemperatureObjectHasNoData() {
        val display =
            DrivingTemperatureStatsProjection.project(
                temperature = DrivingTemperature(inside = null, outside = null),
                loading = false,
                tempUnit = celsius,
                locale = Locale.US,
            )

        assertFalse(display.hasData)
    }

    @Test
    fun projectThreadsLoadingFlag() {
        val display =
            DrivingTemperatureStatsProjection.project(
                temperature = null,
                loading = true,
                tempUnit = celsius,
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
