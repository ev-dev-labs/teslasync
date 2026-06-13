// The native Jetpack Compose + Material 3 MetricSwitcherChart shared surface — a parity port of
// web/src/components/charts/MetricSwitcherChart.tsx. The web surface is a chart with a pill row above it for
// switching the displayed metric: one panel answers several questions ("Distance over time" / "Energy over time"
// / "Score over time") without dedicating a panel to each. It is purely presentational — the caller owns the
// per-metric data series, the active key, and every visible string; the component owns only the layout, the pill
// switcher, the per-metric chart-type selection (bar / area / line), and the empty branch.
//
// This port keeps that contract end to end. The web `ChartContainer` framing maps to the native [ChartContainer]
// (title + glass panel + the chart-canvas accessible-description seam); the web `@/components/forms/PillFilterBar`
// switcher maps to the native [PillFilterBar]; and the web `@/components/feedback/EmptyState` empty branch maps to
// the native [EmptyState]. The web slots the pill row into the container's title-bar action area and lets it
// scroll horizontally; on Android — where that header is tight and a scrolling pill row is cramped — the pills sit
// at the top of the body (the established native MetricSwitcherChart placement), and any caller-supplied [action]
// keeps the header slot, so every affordance survives the platform adaptation. The web Recharts BarChart /
// AreaChart / LineChart map to the native Vico-backed [BarChartWrapper] / [AreaChartWrapper] / [LineChartWrapper]
// so this surface never imports a chart library directly (ADR-012).
//
// All derivation flows through the pure reducers in MetricSwitcherChartModel.kt ([activeMetricOf],
// [metricPillItems], [projectMetric], [MetricProjection.isEmpty], [yAxisFormatter]); this composable owns only the
// one-shot `view.opened` diagnostic (P1/S11). It performs NO HTTP. No static English copy lives in native code —
// every rendered string (`title`, `ariaLabel`, `emptyMessage`, each metric `label`) is caller-supplied, exactly
// as the web component renders its props; the sample data in the @Preview functions is tooling-only.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MetricSwitcherChart) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.metricswitcherchart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartDefaults
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.forms.PillFilterBar
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `color = active?.color ?? '#00f0ff'` — the brand-cyan default series fill/stroke. */
private val DEFAULT_SERIES_COLOR = Color(0xFF00F0FF)

/**
 * Stateful entry point — the faithful port of the web `MetricSwitcherChart`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) and delegates to the stateless [MetricSwitcherChartContent]. Performs no HTTP; the caller
 * owns the data + callbacks, and [logger] defaults to the process logger.
 *
 * @param title the panel heading (web `title`).
 * @param ariaLabel the localized accessible description for the chart canvas (web `ariaLabel`).
 * @param series the per-metric point lists, keyed by metric key (web `series`).
 * @param metrics the switchable metric definitions (web `metrics`).
 * @param activeMetric the key of the currently displayed metric (web `activeMetric`).
 * @param onMetricChange invoked with the tapped metric key (web `onMetricChange`).
 * @param emptyMessage the localized message shown when the active series is empty (web `emptyMessage`).
 * @param xSelector reads the x-axis label from a point — the native equivalent of the web `P extends { date }`
 *   constraint (the web reads `point.date`).
 * @param height the chart height (web `height`, default 220; native compact charts default to
 *   [ChartDefaults.CompactHeight]).
 * @param formatXTick optional x-axis tick formatter (web `formatXTick`).
 * @param action optional trailing title-bar action (web `action`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun <P> MetricSwitcherChart(
    title: String,
    ariaLabel: String,
    series: Map<String, List<P>>,
    metrics: List<MetricSwitcherMetric<P>>,
    activeMetric: String,
    onMetricChange: (String) -> Unit,
    emptyMessage: String,
    xSelector: (P) -> String,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.CompactHeight,
    formatXTick: ((String) -> String)? = null,
    action: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MetricSwitcherChartDiagnostics.recordViewOpened(logger) }
    MetricSwitcherChartContent(
        title = title,
        ariaLabel = ariaLabel,
        series = series,
        metrics = metrics,
        activeMetric = activeMetric,
        onMetricChange = onMetricChange,
        emptyMessage = emptyMessage,
        xSelector = xSelector,
        modifier = modifier,
        height = height,
        formatXTick = formatXTick,
        action = action,
    )
}

/**
 * Stateless renderer for every surface state — the test/preview entry point. Selects the active metric, projects
 * its series, and renders the framed pill switcher plus either the populated chart (bar / area / line) or the
 * [EmptyState] when the active series is empty (web `projected.length === 0`). Diagnostic-free so previews and
 * tests can exercise each branch without a logger.
 */
@Composable
fun <P> MetricSwitcherChartContent(
    title: String,
    ariaLabel: String,
    series: Map<String, List<P>>,
    metrics: List<MetricSwitcherMetric<P>>,
    activeMetric: String,
    onMetricChange: (String) -> Unit,
    emptyMessage: String,
    xSelector: (P) -> String,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.CompactHeight,
    formatXTick: ((String) -> String)? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val active = activeMetricOf(metrics, activeMetric)
    val items = remember(metrics) { metricPillItems(metrics) }
    val projection =
        remember(active, series, xSelector) {
            if (active == null) {
                MetricProjection(emptyList(), emptyList())
            } else {
                projectMetric(series[active.key].orEmpty(), xSelector, active.getValue)
            }
        }

    ChartContainer(
        title = title,
        modifier = modifier,
        height = height,
        accessibleDescription = ariaLabel,
        action = action,
        emptyMessage = emptyMessage,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PillFilterBar(
                items = items,
                selectedId = active?.key,
                onSelect = onMetricChange,
            )
            if (active == null || projection.isEmpty()) {
                EmptyState(message = emptyMessage)
            } else {
                MetricPlot(
                    metric = active,
                    projection = projection,
                    height = height,
                    formatXTick = formatXTick,
                    emptyMessage = emptyMessage,
                )
            }
        }
    }
}

/**
 * Renders the active metric's projected series as the native chart of its [MetricSwitcherMetric.chart] kind —
 * the bar / area / line branch of the web component. The series carries the metric color (web default brand cyan)
 * and unit; the axis honors [yAxisFormatter] (web `yTickFormatter`) and [formatXTick] (web `formatXTick`).
 */
@Composable
private fun <P> MetricPlot(
    metric: MetricSwitcherMetric<P>,
    projection: MetricProjection,
    height: Dp,
    formatXTick: ((String) -> String)?,
    emptyMessage: String,
) {
    val chartSeries =
        ChartSeries(
            key = metric.key,
            label = metric.label,
            values = projection.values,
            kind = metric.chart.toSeriesKind(),
            color = metric.color ?: DEFAULT_SERIES_COLOR,
            unit = metric.unit,
        )
    val xFormatter: (String) -> String = formatXTick ?: { it }
    val yFormatter = yAxisFormatter(metric)
    val xLabels = projection.xLabels
    when (metric.chart) {
        MetricChartKind.Bar ->
            BarChartWrapper(
                series = listOf(chartSeries),
                xLabels = xLabels,
                height = height,
                yValueFormatter = yFormatter,
                xValueFormatter = xFormatter,
                emptyMessage = emptyMessage,
            )
        MetricChartKind.Area ->
            AreaChartWrapper(
                series = listOf(chartSeries),
                xLabels = xLabels,
                height = height,
                yValueFormatter = yFormatter,
                xValueFormatter = xFormatter,
                emptyMessage = emptyMessage,
            )
        MetricChartKind.Line ->
            LineChartWrapper(
                series = listOf(chartSeries),
                xLabels = xLabels,
                height = height,
                yValueFormatter = yFormatter,
                xValueFormatter = xFormatter,
                emptyMessage = emptyMessage,
            )
    }
}

/** Maps the surface [MetricChartKind] onto the chart-layer [ChartSeriesKind] the wrappers force. */
private fun MetricChartKind.toSeriesKind(): ChartSeriesKind =
    when (this) {
        MetricChartKind.Bar -> ChartSeriesKind.Bar
        MetricChartKind.Area -> ChartSeriesKind.Area
        MetricChartKind.Line -> ChartSeriesKind.Line
    }

// ── Previews (tooling-only; sample data is never shipped UI) ─────────────────────────────────────────────────
// The surface's real states: a populated bar metric (the default), a populated area metric, a populated line
// metric, and the empty branch (an active metric whose series is empty → EmptyState).

@Preview(name = "Bar — active metric", showBackground = true)
@Composable
private fun MetricSwitcherChartBarPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MetricSwitcherChartContent(
            title = "Trends",
            ariaLabel = "Trends chart, distance per day",
            series =
                mapOf(
                    "distance" to
                        listOf(
                            MetricPoint("Mon", 42.0),
                            MetricPoint("Tue", 18.0),
                            MetricPoint("Wed", 63.0),
                            MetricPoint("Thu", 25.0),
                            MetricPoint("Fri", 51.0),
                        ),
                    "energy" to
                        listOf(
                            MetricPoint("Mon", 9.4),
                            MetricPoint("Tue", 4.1),
                            MetricPoint("Wed", 13.8),
                            MetricPoint("Thu", 6.0),
                            MetricPoint("Fri", 11.2),
                        ),
                ),
            metrics =
                listOf(
                    metricPointMetric("distance", "Distance", MetricChartKind.Bar),
                    metricPointMetric("energy", "Energy", MetricChartKind.Area),
                ),
            activeMetric = "distance",
            onMetricChange = {},
            emptyMessage = "No drives in this range",
            xSelector = { it.date },
        )
    }
}

@Preview(name = "Area — active metric (dark)", showBackground = true)
@Composable
private fun MetricSwitcherChartAreaPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        MetricSwitcherChartContent(
            title = "Trends",
            ariaLabel = "Trends chart, energy per day",
            series =
                mapOf(
                    "distance" to
                        listOf(
                            MetricPoint("Mon", 42.0),
                            MetricPoint("Tue", 18.0),
                            MetricPoint("Wed", 63.0),
                        ),
                    "energy" to
                        listOf(
                            MetricPoint("Mon", 9.4),
                            MetricPoint("Tue", 4.1),
                            MetricPoint("Wed", 13.8),
                        ),
                ),
            metrics =
                listOf(
                    metricPointMetric("distance", "Distance", MetricChartKind.Bar),
                    metricPointMetric("energy", "Energy", MetricChartKind.Area),
                ),
            activeMetric = "energy",
            onMetricChange = {},
            emptyMessage = "No drives in this range",
            xSelector = { it.date },
        )
    }
}

@Preview(name = "Line — active metric", showBackground = true)
@Composable
private fun MetricSwitcherChartLinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MetricSwitcherChartContent(
            title = "Trends",
            ariaLabel = "Trends chart, efficiency score per day",
            series =
                mapOf(
                    "score" to
                        listOf(
                            MetricPoint("Mon", 86.0),
                            MetricPoint("Tue", 91.0),
                            MetricPoint("Wed", 78.0),
                            MetricPoint("Thu", 95.0),
                        ),
                ),
            metrics =
                listOf(
                    metricPointMetric(
                        key = "score",
                        label = "Score",
                        chart = MetricChartKind.Line,
                    ).copy(formatValue = { "${it.toInt()}%" }),
                ),
            activeMetric = "score",
            onMetricChange = {},
            emptyMessage = "No drives in this range",
            xSelector = { it.date },
        )
    }
}

@Preview(name = "Empty — active metric, no data", showBackground = true)
@Composable
private fun MetricSwitcherChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MetricSwitcherChartContent(
            title = "Trends",
            ariaLabel = "Trends chart, distance per day",
            series = mapOf("distance" to emptyList<MetricPoint>()),
            metrics =
                listOf(
                    metricPointMetric("distance", "Distance", MetricChartKind.Bar),
                    metricPointMetric("energy", "Energy", MetricChartKind.Area),
                ),
            activeMetric = "distance",
            onMetricChange = {},
            emptyMessage = "No drives in this range",
            xSelector = { it.date },
        )
    }
}
