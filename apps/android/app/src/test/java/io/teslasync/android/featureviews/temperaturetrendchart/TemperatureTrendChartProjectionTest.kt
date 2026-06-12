package io.teslasync.android.featureviews.temperaturetrendchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Temperature Trend chart's pure logic — the native analogue of the web
 * component's data mapping + reference thresholds
 * (web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx): the SI Celsius ->
 * display conversion of the plotted line and the Warm Zone / Freezing thresholds, the null/non-finite gap
 * handling, the `data.length <= 1` content/empty boundary (counting finite points), the locale-aware number
 * formatting, the `t(key, default)` resolve-or-fallback for the absent aria key, and the PII-safe
 * `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate.
 */
class TemperatureTrendChartProjectionTest {
    private companion object {
        const val EPS: Double = 1e-9
        val CELSIUS: TemperatureUnitPref = TemperatureUnitPref.CELSIUS
        val FAHRENHEIT: TemperatureUnitPref = TemperatureUnitPref.FAHRENHEIT
    }

    private fun point(
        date: String,
        temp: Double?,
    ): TempTrendPoint = TempTrendPoint(date = date, outsideTempC = temp)

    // ── Conversion: line values + table (web outsideTemp line, fixed for the latent inconsistency) ──

    @Test
    fun projectInCelsiusPassesValuesThroughAndBuildsDatesAndTable() {
        val points = listOf(point("Feb 04", -2.0), point("Feb 19", 8.5), point("Mar 06", 21.0))

        val result = TemperatureTrendChartProjection.project(points, CELSIUS, precision = 1, locale = Locale.US)

        assertEquals(listOf("Feb 04", "Feb 19", "Mar 06"), result.dates)
        assertEquals(listOf<Double?>(-2.0, 8.5, 21.0), result.tempValues)
        assertEquals(
            listOf(
                listOf("Feb 04", "-2.0"),
                listOf("Feb 19", "8.5"),
                listOf("Mar 06", "21.0"),
            ),
            result.tableRows,
        )
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectConvertsLineAndTableToFahrenheit() {
        val points = listOf(point("a", 0.0), point("b", 100.0))

        val result = TemperatureTrendChartProjection.project(points, FAHRENHEIT, precision = 1, locale = Locale.US)

        // 0 °C -> 32 °F, 100 °C -> 212 °F (web convertTempFromSI applied to the line, not just the axis).
        assertEquals(listOf<Double?>(32.0, 212.0), result.tempValues)
        assertEquals(listOf(listOf("a", "32.0"), listOf("b", "212.0")), result.tableRows)
    }

    // ── Reference thresholds (web <ReferenceLine y={toDisplay(35)} /> + y={toDisplay(0)}) ───────────

    @Test
    fun projectFormatsThresholdsWithUnitInCelsius() {
        val result = TemperatureTrendChartProjection.project(listOf(point("a", 1.0), point("b", 2.0)), CELSIUS, 1, Locale.US)

        assertEquals("35.0\u00B0C", result.warmZoneDisplay)
        assertEquals("0.0\u00B0C", result.freezingDisplay)
    }

    @Test
    fun projectConvertsThresholdsToFahrenheit() {
        val result = TemperatureTrendChartProjection.project(listOf(point("a", 1.0), point("b", 2.0)), FAHRENHEIT, 1, Locale.US)

        // toDisplay(35 °C) = 95 °F, toDisplay(0 °C) = 32 °F.
        assertEquals("95.0\u00B0F", result.warmZoneDisplay)
        assertEquals("32.0\u00B0F", result.freezingDisplay)
    }

    // ── Null / non-finite handling (line gap + em-dash table cell) ─────────────────────────────────

    @Test
    fun projectTreatsNullAndNonFiniteTempsAsGapsAndEmDashCells() {
        val points = listOf(point("a", null), point("b", 10.0), point("c", Double.NaN), point("d", 20.0))

        val result = TemperatureTrendChartProjection.project(points, CELSIUS, precision = 1, locale = Locale.US)

        assertEquals(listOf<Double?>(null, 10.0, null, 20.0), result.tempValues)
        assertEquals("$EM_DASH", result.tableRows[0][1])
        assertEquals("10.0", result.tableRows[1][1])
        assertEquals("$EM_DASH", result.tableRows[2][1])
        // Two finite points → renderable trend.
        assertFalse(result.isEmpty)
    }

    // ── Content/empty boundary (web data.length <= 1, counting finite points) ──────────────────────

    @Test
    fun projectIsEmptyForNoPoints() {
        assertTrue(TemperatureTrendChartProjection.project(emptyList(), CELSIUS, 1, Locale.US).isEmpty)
    }

    @Test
    fun projectIsEmptyForSingleFinitePoint() {
        assertTrue(TemperatureTrendChartProjection.project(listOf(point("a", 5.0)), CELSIUS, 1, Locale.US).isEmpty)
    }

    @Test
    fun projectIsEmptyWhenOnlyOneFiniteAmongNulls() {
        val points = listOf(point("a", null), point("b", 6.0))

        assertTrue(TemperatureTrendChartProjection.project(points, CELSIUS, 1, Locale.US).isEmpty)
    }

    @Test
    fun projectIsContentForTwoFinitePoints() {
        val points = listOf(point("a", 5.0), point("b", 6.0))

        assertFalse(TemperatureTrendChartProjection.project(points, CELSIUS, 1, Locale.US).isEmpty)
    }

    // ── formatNumber (locale-aware fixed precision; web Intl.NumberFormat) ─────────────────────────

    @Test
    fun formatNumberGroupsAndHonorsPrecision() {
        assertEquals("35.0", TemperatureTrendChartProjection.formatNumber(35.0, 1, Locale.US))
        assertEquals("1,234.5", TemperatureTrendChartProjection.formatNumber(1_234.5, 1, Locale.US))
        assertEquals("22", TemperatureTrendChartProjection.formatNumber(22.0, 0, Locale.US))
        assertEquals("-2.0", TemperatureTrendChartProjection.formatNumber(-2.0, 1, Locale.US))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZero() {
        assertEquals("0.0", TemperatureTrendChartProjection.formatNumber(Double.NaN, 1, Locale.US))
        assertEquals("0.0", TemperatureTrendChartProjection.formatNumber(Double.POSITIVE_INFINITY, 1, Locale.US))
    }

    @Test
    fun projectHonorsUserPrecisionInTableAndThresholds() {
        val points = listOf(point("a", 1.0), point("b", 2.5))

        val result = TemperatureTrendChartProjection.project(points, CELSIUS, precision = 0, locale = Locale.US)

        // Zero-decimal formatting rounds half up (Java Formatter / web Intl.NumberFormat): 2.5 -> "3".
        assertEquals(listOf(listOf("a", "1"), listOf("b", "3")), result.tableRows)
        assertEquals("35\u00B0C", result.warmZoneDisplay)
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved = resolveOptional({ mapOf(KEY_ARIA to "Catalog aria")[it] }, KEY_ARIA, TemperatureTrendChartDefaults.ARIA_LABEL)

        assertEquals("Catalog aria", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        val default = TemperatureTrendChartDefaults.ARIA_LABEL
        assertEquals(default, resolveOptional({ null }, KEY_ARIA, default))
        assertEquals(default, resolveOptional({ "   " }, KEY_ARIA, default))
    }

    // ── Locale resolution (web useUnits locale, en-US fallback) ────────────────────────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlank() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
        assertEquals(Locale.forLanguageTag("de-DE"), resolveDisplayLocale("de-DE"))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordTemperatureTrendChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TemperatureTrendChart"), fields)
    }

    @Test
    fun constantsMatchTheWebThresholdsAndGuard() {
        assertEquals(35.0, WARM_ZONE_C, EPS)
        assertEquals(0.0, FREEZING_C, EPS)
        assertEquals(1, MIN_TREND_POINTS)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
