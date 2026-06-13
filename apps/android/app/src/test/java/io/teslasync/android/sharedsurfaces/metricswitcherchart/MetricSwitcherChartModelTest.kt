package io.teslasync.android.sharedsurfaces.metricswitcherchart

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.forms.PillItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the MetricSwitcherChart's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/charts/MetricSwitcherChart.tsx): the active-metric selection
 * (`find ?? metrics[0]`), the pill-row mapping, the cached → projection adapter (the per-metric `getValue` +
 * x-selector applied to the active series), the empty guard (`projected.length === 0`), the chart-kind default
 * (`chart ?? 'bar'`), and the axis-formatter precedence (`formatTick ?? formatValue ?? String(v)`). Because the
 * composable is a thin render layer over these reducers, the per-branch assertions here double as the surface's
 * per-state coverage. Runs in the :app:testReleaseUnitTest gate.
 */
class MetricSwitcherChartModelTest {
    /** A non-canonical caller point type, so the generic `getValue` + x-selector are genuinely exercised. */
    private data class Drive(
        val day: String,
        val distance: Double,
        val energy: Double,
    )

    private val drives =
        listOf(
            Drive("2026-04-01", 42.0, 9.4),
            Drive("2026-04-02", 18.0, 4.1),
            Drive("2026-04-03", 63.0, 13.8),
        )

    private fun metrics(): List<MetricSwitcherMetric<Drive>> =
        listOf(
            MetricSwitcherMetric("distance", "Distance", getValue = { it.distance }, chart = MetricChartKind.Bar),
            MetricSwitcherMetric("energy", "Energy", getValue = { it.energy }, chart = MetricChartKind.Area),
        )

    // ── active metric selection (web `metrics.find(...) ?? metrics[0]`) ───────────────────────────────

    @Test
    fun activeMetricSelectsTheKeyedMetric() {
        assertEquals("energy", activeMetricOf(metrics(), "energy")?.key)
    }

    @Test
    fun activeMetricFallsBackToFirstWhenKeyAbsent() {
        assertEquals("distance", activeMetricOf(metrics(), "nonexistent")?.key)
    }

    @Test
    fun activeMetricIsNullWhenNoMetrics() {
        assertEquals(null, activeMetricOf(emptyList<MetricSwitcherMetric<Drive>>(), "distance"))
    }

    // ── pill items (web `metrics.map(m => ({ key, label }))`) ─────────────────────────────────────────

    @Test
    fun pillItemsMapKeyAndLabelInOrder() {
        assertEquals(
            listOf(PillItem("distance", "Distance"), PillItem("energy", "Energy")),
            metricPillItems(metrics()),
        )
    }

    // ── projection: the cached → projection adapter (web projected map over the active series) ─────────

    @Test
    fun projectMetricExtractsXAndYInOrder() {
        val active = requireNotNull(activeMetricOf(metrics(), "distance"))
        val projection = projectMetric(drives, { it.day }, active.getValue)
        assertEquals(listOf("2026-04-01", "2026-04-02", "2026-04-03"), projection.xLabels)
        assertEquals(listOf(42.0, 18.0, 63.0), projection.values)
        assertFalse(projection.isEmpty())
    }

    @Test
    fun projectMetricHonorsThePerMetricValueExtractor() {
        val energy = requireNotNull(activeMetricOf(metrics(), "energy"))
        val projection = projectMetric(drives, { it.day }, energy.getValue)
        assertEquals(listOf(9.4, 4.1, 13.8), projection.values)
    }

    @Test
    fun projectMetricOfNoPointsIsEmpty() {
        val active = requireNotNull(activeMetricOf(metrics(), "distance"))
        val projection = projectMetric(emptyList<Drive>(), { it.day }, active.getValue)
        assertTrue(projection.isEmpty())
        assertEquals(emptyList<String>(), projection.xLabels)
    }

    // ── canonical MetricPoint convenience (web zero-config `getValue = p => p.value`) ─────────────────

    @Test
    fun metricPointMetricDefaultsValueExtractorToThePointValue() {
        val metric = metricPointMetric("score", "Score")
        assertEquals(7.5, metric.getValue(MetricPoint("2026-04-01", 7.5)), 0.0)
    }

    @Test
    fun metricPointMetricDefaultsToBarChart() {
        assertEquals(MetricChartKind.Bar, metricPointMetric("score", "Score").chart)
    }

    // ── chart-kind default (web `chart ?? 'bar'`) ─────────────────────────────────────────────────────

    @Test
    fun metricDefaultsToBarChartWhenUnset() {
        val metric = MetricSwitcherMetric<Drive>(key = "k", label = "L", getValue = { it.distance })
        assertEquals(MetricChartKind.Bar, metric.chart)
    }

    // ── axis-formatter precedence (web `yTickFormatter`: formatTick ?? formatValue ?? String(v)) ──────

    @Test
    fun yAxisFormatterPrefersFormatTick() {
        val metric =
            MetricSwitcherMetric<Drive>(
                key = "k",
                label = "L",
                getValue = { it.distance },
                formatValue = { "V$it" },
                formatTick = { "T$it" },
            )
        assertEquals("T12.0", yAxisFormatter(metric)(12.0))
    }

    @Test
    fun yAxisFormatterFallsBackToFormatValue() {
        val metric =
            MetricSwitcherMetric<Drive>(
                key = "k",
                label = "L",
                getValue = { it.distance },
                formatValue = { "V$it" },
            )
        assertEquals("V12.0", yAxisFormatter(metric)(12.0))
    }

    @Test
    fun yAxisFormatterFallsBackToLocaleDefaultWhenUnset() {
        val metric = MetricSwitcherMetric<Drive>(key = "k", label = "L", getValue = { it.distance })
        // The native default rounds to ChartDefaults.DECIMALS and groups locale-aware — never raw, never NaN.
        assertEquals(ChartFormat.number(12.34, 1), yAxisFormatter(metric)(12.34))
    }
}
