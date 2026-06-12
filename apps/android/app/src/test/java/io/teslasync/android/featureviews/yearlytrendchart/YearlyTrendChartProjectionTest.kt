package io.teslasync.android.featureviews.yearlytrendchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Yearly-Charging-Speed-Trend chart's pure logic — the native analogue of the
 * web component's reads of its `yearlyTrend` prop
 * (web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx): the render-ready projection
 * (year x-axis + the bar/two-line series + the `dataColumns` fallback table, in received order), the
 * non-finite-sample guard, the by-name `t(key, default)` fallback resolution, and the PII-safe `view.opened`
 * diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class YearlyTrendChartProjectionTest {
    private val points =
        listOf(
            YearlyTrendPoint(year = "2023", avg10to80 = 42.5, avg20to80 = 31.2, count = 84),
            YearlyTrendPoint(year = "2024", avg10to80 = 38.0, avg20to80 = 28.5, count = 132),
        )

    private val formatters =
        YearlyTrendChartFormatters(
            avgMinutes = { "m($it)" },
            sessionCount = { "c($it)" },
        )

    // ── Projection (web ComposedChart series + dataColumns table) ──────────────────

    @Test
    fun projectBuildsLabelsSeriesAndTableInReceivedOrder() {
        val result = YearlyTrendChartProjection.project(points, formatters)

        assertFalse(result.isEmpty)
        assertEquals(listOf("2023", "2024"), result.xLabels)
        assertEquals(listOf<Double?>(42.5, 38.0), result.avg10to80Values)
        assertEquals(listOf<Double?>(31.2, 28.5), result.avg20to80Values)
        assertEquals(listOf<Double?>(84.0, 132.0), result.countValues)

        assertEquals(
            listOf(
                listOf("2023", "m(42.5)", "m(31.2)", "c(84)"),
                listOf("2024", "m(38.0)", "m(28.5)", "c(132)"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectMapsNonFiniteAvgToNullWhileKeepingCount() {
        val result =
            YearlyTrendChartProjection.project(
                listOf(YearlyTrendPoint("2025", Double.NaN, Double.POSITIVE_INFINITY, 7)),
                formatters,
            )

        assertEquals(listOf<Double?>(null), result.avg10to80Values)
        assertEquals(listOf<Double?>(null), result.avg20to80Values)
        assertEquals(listOf<Double?>(7.0), result.countValues)
    }

    @Test
    fun projectReturnsEmptyResultForNoPoints() {
        val result = YearlyTrendChartProjection.project(emptyList(), formatters)

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.avg10to80Values.isEmpty())
        assertTrue(result.avg20to80Values.isEmpty())
        assertTrue(result.countValues.isEmpty())
        assertTrue(result.tableRows.isEmpty())
    }

    // ── By-name fallback resolution (web t(key, default) parity) ───────────────────

    @Test
    fun resolveOptionalPrefersCatalogValueThenFallsBackForBlankOrAbsentKeys() {
        val lookup: (String) -> String? =
            { name -> mapOf("present" to "Catalog Value", "blank" to "   ")[name] }

        assertEquals("Catalog Value", resolveOptional(lookup, "present", "Fallback"))
        assertEquals("Fallback", resolveOptional(lookup, "blank", "Fallback"))
        assertEquals("Fallback", resolveOptional(lookup, "absent", "Fallback"))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordYearlyTrendChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "YearlyTrendChart"), fields)
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
