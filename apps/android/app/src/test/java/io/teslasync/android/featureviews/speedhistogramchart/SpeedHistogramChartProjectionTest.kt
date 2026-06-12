package io.teslasync.android.featureviews.speedhistogramchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Speed Histogram chart's pure logic — the native analogue of the web
 * component's prop-to-chart binding (web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx):
 * the buckets → (xLabels, values, accessible-table rows) projection with its empty guard and preserved
 * order, the locale-grouped whole-percent formatting (web integer `pct`), and the PII-safe `view.opened`
 * diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class SpeedHistogramChartProjectionTest {
    private val buckets =
        listOf(
            SpeedHistogramBucket(range = "0–20", pct = 12.0),
            SpeedHistogramBucket(range = "20–40", pct = 28.0),
            SpeedHistogramBucket(range = "120+", pct = 60.0),
        )

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsBucketsPreservingOrderWithLabelsValuesAndTableRows() {
        val result =
            SpeedHistogramChartProjection.project(
                buckets = buckets,
                formatPct = { pct -> "p:$pct" },
            )

        assertFalse(result.isEmpty)
        assertEquals(listOf("0–20", "20–40", "120+"), result.xLabels)
        assertEquals(listOf(12.0, 28.0, 60.0), result.values)
        assertEquals(
            listOf(
                listOf("0–20", "p:12.0"),
                listOf("20–40", "p:28.0"),
                listOf("120+", "p:60.0"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoBuckets() {
        val result =
            SpeedHistogramChartProjection.project(
                buckets = emptyList(),
                formatPct = { it.toString() },
            )

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.values.isEmpty())
        assertTrue(result.tableRows.isEmpty())
    }

    // ── Percent formatting (web integer `pct` parity) ─────────────────────────────

    @Test
    fun formatPctRendersGroupedWholePercentAndHandlesZero() {
        assertEquals("0", SpeedHistogramChartProjection.formatPct(0.0, Locale.US))
        assertEquals("42", SpeedHistogramChartProjection.formatPct(42.0, Locale.US))
        assertEquals("100", SpeedHistogramChartProjection.formatPct(100.0, Locale.US))
        assertEquals("1,000", SpeedHistogramChartProjection.formatPct(1_000.0, Locale.US))
    }

    @Test
    fun formatPctRoundsHalfUpForDefensivelyUnroundedHostValues() {
        assertEquals("13", SpeedHistogramChartProjection.formatPct(12.5, Locale.US))
        assertEquals("12", SpeedHistogramChartProjection.formatPct(12.4, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSpeedHistogramChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SpeedHistogramChart"), fields)
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
