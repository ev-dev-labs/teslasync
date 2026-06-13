// The pure, framework-light model + projection + diagnostics for the MetricSwitcherChart shared surface — the
// native analogue of every decision the web component makes (web/src/components/charts/MetricSwitcherChart.tsx)
// before it paints. No Compose runtime, no Android, no HTTP: every declaration here is unit-tested off-device in
// the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL chart with a pill row above it for switching the displayed metric. It has NO data
//     hook — the caller owns `series` (one point list per metric key), the `metrics` definitions, the
//     `activeMetric` key, and every visible string (`title`, `ariaLabel`, `emptyMessage`, each metric `label`).
//     So there is no data port to bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent
//     a fetch the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The closest
//     precedent is the equally presentational ChartExportMenu surface (composable + model, no Source/ViewModel).
//   • The active metric is `metrics.find(m => m.key === activeMetric) ?? metrics[0]` — reduced in [activeMetricOf].
//   • The pill row is `metrics.map(m => ({ key, label, accent }))` — reduced in [metricPillItems] (the web
//     `accent` / `scrollable` are PillFilterBar styling the native PillFilterBar abstracts away).
//   • The plotted data is `series[active.key].map(p => ({ ...p, __value: getValue(p) }))` with the x-axis read
//     from each point's `date` — reduced in [projectMetric] into the parallel x-labels + y-values the native
//     chart layer consumes.
//   • The empty branch is `projected.length === 0 → <EmptyState/>` — reduced in [MetricProjection.isEmpty].
//   • The chart type is `active.chart ?? 'bar'` (bar | area | line) — modelled by [MetricChartKind] (default
//     [MetricChartKind.Bar]); the view maps it onto the matching native chart wrapper.
//   • The axis tick formatter is `formatTick ?? formatValue ?? String(v)` — reduced in [yAxisFormatter].
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it renders caller-owned, already-loaded series. Its real, fully-reproduced states are the
// empty projection (→ EmptyState) and the three populated chart kinds (bar / area / line), each reduced here and
// asserted in the off-device test; the @Preview entry points render each one.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/MetricSwitcherChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.metricswitcherchart

import androidx.compose.ui.graphics.Color
import io.teslasync.android.components.charts.ChartDefaults
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.forms.PillItem
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The visualization a metric plots — the native mirror of the web `chart?: 'bar' | 'area' | 'line'`. [Bar] is the
 * web default (safest for count-like metrics with many zero days); [Area] and [Line] suit continuous series like
 * efficiency or score.
 */
enum class MetricChartKind { Bar, Area, Line }

/**
 * The canonical `{ date, value }` point — the zero-config shape the web supports out of the box (its `getValue`
 * defaults to `p => p.value`). Build canonical metrics with [metricPointMetric]; callers with a richer point type
 * use [MetricSwitcherMetric] directly and supply their own `getValue` + x-selector.
 */
data class MetricPoint(
    val date: String,
    val value: Double,
)

/**
 * One switchable metric — the native mirror of the web `MetricSwitcherMetric<P>`. [key] drives the active state +
 * pill identity; [label] is the pill caption and series name; [getValue] extracts the y value from a point (web
 * `getValue`); [chart] picks the visualization (web `chart`, default bar); [color] is the series fill/stroke (web
 * `color`, defaulted to brand cyan at the view); [unit] is an optional value suffix; [formatValue] / [formatTick]
 * format tooltip / axis values (web `formatValue` / `formatTick`).
 */
data class MetricSwitcherMetric<P>(
    val key: String,
    val label: String,
    val getValue: (P) -> Double,
    val chart: MetricChartKind = MetricChartKind.Bar,
    val color: Color? = null,
    val unit: String? = null,
    val formatValue: ((Double) -> String)? = null,
    val formatTick: ((Double) -> String)? = null,
)

/**
 * Convenience builder for a metric over the canonical [MetricPoint] — mirrors the web zero-config default where
 * `getValue` falls back to `p => p.value`, pre-filling the extractor for the common `{ date, value }` shape. Pair
 * it with the canonical x-selector `{ it.date }`. Set the advanced fields (color / unit / formatValue / formatTick)
 * with [MetricSwitcherMetric.copy] when needed, e.g. `metricPointMetric("eff", "Efficiency").copy(unit = "Wh/mi")`.
 */
fun metricPointMetric(
    key: String,
    label: String,
    chart: MetricChartKind = MetricChartKind.Bar,
): MetricSwitcherMetric<MetricPoint> =
    MetricSwitcherMetric(
        key = key,
        label = label,
        getValue = { it.value },
        chart = chart,
    )

/**
 * The active metric for [activeKey] — a 1:1 port of the web `metrics.find(m => m.key === activeMetric) ??
 * metrics[0]`: the keyed metric when present, else the first metric, else `null` when there are no metrics.
 */
fun <P> activeMetricOf(
    metrics: List<MetricSwitcherMetric<P>>,
    activeKey: String,
): MetricSwitcherMetric<P>? = metrics.firstOrNull { it.key == activeKey } ?: metrics.firstOrNull()

/**
 * The pill-row items — a 1:1 port of the web `metrics.map(m => ({ key, label, accent }))`. The web `accent` is
 * PillFilterBar styling the native [PillItem] does not carry, so only the stable [PillItem.id] (= the metric key)
 * and [PillItem.label] cross over; the selection highlight is applied by the caller via the active key.
 */
fun <P> metricPillItems(metrics: List<MetricSwitcherMetric<P>>): List<PillItem> = metrics.map { PillItem(id = it.key, label = it.label) }

/**
 * The projected series for one metric: parallel [xLabels] (each point's `date`) and [values] (its extracted y).
 * The web builds `projected = data.map(p => ({ ...p, __value: getValue(p) }))` and reads the x-axis from `date`;
 * this is that projection split into the two parallel lists the native chart layer consumes.
 */
data class MetricProjection(
    val xLabels: List<String>,
    val values: List<Double>,
)

/** Whether the projected series has no points — the web `projected.length === 0` empty guard. */
fun MetricProjection.isEmpty(): Boolean = values.isEmpty()

/**
 * Projects [points] into a [MetricProjection] — a 1:1 port of the web projection: [xOf] reads each point's x
 * value (web `date`) and [getValue] its y value (web `getValue`), preserving order and length. The native chart
 * bridges any non-finite y the same way the web `connectNulls` does, so no filtering happens here.
 */
fun <P> projectMetric(
    points: List<P>,
    xOf: (P) -> String,
    getValue: (P) -> Double,
): MetricProjection {
    val xLabels = ArrayList<String>(points.size)
    val values = ArrayList<Double>(points.size)
    points.forEach { point ->
        xLabels += xOf(point)
        values += getValue(point)
    }
    return MetricProjection(xLabels = xLabels, values = values)
}

/**
 * The value-axis formatter for [metric] — a 1:1 port of the web `yTickFormatter`: prefer [MetricSwitcherMetric
 * .formatTick], else [MetricSwitcherMetric.formatValue], else the locale-aware default (the native
 * [ChartFormat.number] in place of the web `String(v)`, so axes group + round consistently with the rest of the
 * chart layer). The web `formatValue` tooltip role maps to this axis fallback because the native chart wrapper
 * owns the hover marker and exposes no per-value tooltip seam; the marker reads the series `unit` instead.
 */
fun <P> yAxisFormatter(metric: MetricSwitcherMetric<P>): (Double) -> String =
    { value ->
        metric.formatTick?.invoke(value)
            ?: metric.formatValue?.invoke(value)
            ?: ChartFormat.number(value, ChartDefaults.DECIMALS)
    }

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). A constant identifier carrying no
 * metric label, value, or chart title, so a diagnostics line can never leak what the operator was viewing.
 */
const val METRIC_SWITCHER_CHART_SLUG: String = "MetricSwitcherChart"

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a metric
 * label, value, or chart title — so a diagnostics line can never leak what the operator was viewing.
 */
object MetricSwitcherChartDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = METRIC_SWITCHER_CHART_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
