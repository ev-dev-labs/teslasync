package io.teslasync.android.featureviews.poweroutputchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Power Output History chart's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx):
 * the `date` / `powerMax` / `powerMin` mapping that feeds the two areas + the accessible table, the
 * `data.length <= 1` content/empty boundary (web `if (data.length <= 1) return null`), the one-decimal
 * locale-aware kW formatting (`safeNumber` non-finite coercion + grouping), the `t(key, default)`
 * resolve-or-fallback for the catalog-absent aria key, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class PowerOutputChartProjectionTest {
    // Stub formatter tags each value so the test pins which value lands in which table column / series.
    private fun stubFormat(): (Double) -> String = { "F($it)" }

    private val drives =
        listOf(
            PowerOutputPoint(date = "Feb 04", powerMax = 211.4, powerMin = -64.2),
            PowerOutputPoint(date = "Feb 11", powerMax = 188.0, powerMin = -52.7),
            PowerOutputPoint(date = "Feb 18", powerMax = 233.9, powerMin = 0.0),
        )

    // ── Projection: series columns + order preservation (web data map) ─────────────

    @Test
    fun projectPreservesOrderAndSplitsPeakAndRegenSeries() {
        val result = PowerOutputChartProjection.project(drives, stubFormat())

        assertEquals(listOf("Feb 04", "Feb 11", "Feb 18"), result.dates)
        assertEquals(listOf(211.4, 188.0, 233.9), result.peakValues)
        assertEquals(listOf(-64.2, -52.7, 0.0), result.regenValues)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectBuildsAccessibleTableRowPerDriveWithFormattedKw() {
        val result = PowerOutputChartProjection.project(drives, stubFormat())

        // Each row is [date, formatValue(powerMax), formatValue(powerMin)] — the web dataColumns order.
        assertEquals(listOf("Feb 04", "F(211.4)", "F(-64.2)"), result.tableRows[0])
        assertEquals(listOf("Feb 11", "F(188.0)", "F(-52.7)"), result.tableRows[1])
        assertEquals(listOf("Feb 18", "F(233.9)", "F(0.0)"), result.tableRows[2])
        assertEquals(drives.size, result.tableRows.size)
    }

    // ── Projection: content/empty boundary (web data.length <= 1) ──────────────────

    @Test
    fun projectIsEmptyForZeroOrOneDriveAndContentForTwoPlus() {
        assertTrue(PowerOutputChartProjection.project(emptyList(), stubFormat()).isEmpty)
        assertTrue(PowerOutputChartProjection.project(listOf(drives.first()), stubFormat()).isEmpty)

        val two = PowerOutputChartProjection.project(drives.take(2), stubFormat())
        assertFalse(two.isEmpty)
        assertEquals(2, two.dates.size)
    }

    @Test
    fun projectEmptyInputYieldsEmptyColumnsAndTable() {
        val result = PowerOutputChartProjection.project(emptyList(), stubFormat())

        assertTrue(result.dates.isEmpty())
        assertTrue(result.peakValues.isEmpty())
        assertTrue(result.regenValues.isEmpty())
        assertTrue(result.tableRows.isEmpty())
        assertTrue(result.isEmpty)
    }

    // ── formatKw (one-decimal, locale-aware, safeNumber parity) ────────────────────

    @Test
    fun formatKwRendersOneDecimalWithGrouping() {
        assertEquals("211.4", PowerOutputChartProjection.formatKw(211.4, Locale.US))
        assertEquals("1,234.5", PowerOutputChartProjection.formatKw(1234.5, Locale.US))
        assertEquals("0.0", PowerOutputChartProjection.formatKw(0.0, Locale.US))
    }

    @Test
    fun formatKwKeepsNegativeRegenSign() {
        assertEquals("-52.7", PowerOutputChartProjection.formatKw(-52.7, Locale.US))
    }

    @Test
    fun formatKwCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.0", PowerOutputChartProjection.formatKw(Double.NaN, Locale.US))
        assertEquals("0.0", PowerOutputChartProjection.formatKw(Double.POSITIVE_INFINITY, Locale.US))
    }

    @Test
    fun formatKwHonorsLocaleSeparators() {
        // German uses '.' for grouping and ',' for the decimal — proves the formatter is locale-driven.
        assertEquals("1.234,5", PowerOutputChartProjection.formatKw(1234.5, Locale.GERMANY))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved =
            resolveOptional({ mapOf(KEY_ARIA to "Catalog aria")[it] }, KEY_ARIA, PowerOutputChartDefaults.ARIA_LABEL)
        assertEquals("Catalog aria", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(
            PowerOutputChartDefaults.ARIA_LABEL,
            resolveOptional({ null }, KEY_ARIA, PowerOutputChartDefaults.ARIA_LABEL),
        )
        assertEquals(
            PowerOutputChartDefaults.ARIA_LABEL,
            resolveOptional({ "   " }, KEY_ARIA, PowerOutputChartDefaults.ARIA_LABEL),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordPowerOutputChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "PowerOutputChart"), fields)
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
