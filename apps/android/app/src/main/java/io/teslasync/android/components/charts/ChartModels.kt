package io.teslasync.android.components.charts

import androidx.compose.ui.graphics.Color

/**
 * Framework-light data model for the chart layer, mirroring the props the web
 * `components/charts` wrappers accept. Pages build these immutable values from
 * SI-domain data + display-formatted labels and hand them to the chart wrappers;
 * the wrappers own all Vico/Compose rendering so pages never import a chart
 * library directly.
 *
 * Values are nullable to represent gaps (the Android counterpart of the web
 * `connectNulls`): a `null` sample is skipped and the line is drawn across it.
 */
enum class ChartSeriesKind { Line, Area, Bar }

/** One plotted series. [color] of `null` resolves to the brand palette by position. */
data class ChartSeries(
    val key: String,
    val label: String,
    val values: List<Double?>,
    val kind: ChartSeriesKind = ChartSeriesKind.Line,
    val color: Color? = null,
    val unit: String? = null,
)

/** Severity for a [ChartVerticalMarker]; resolves to the per-theme status palette at render time. */
enum class MarkerSeverity { Info, Warn, Critical, Success }

/**
 * A point-in-time marker (alert moment, annotation, replay cursor) anchored to an
 * x-axis [index]. Rendered by the chart wrappers as an aligned marker rail above
 * the plot — see `ChartAnnotationLayer`/`TimeMarker` and the SURVEY for why a rail
 * replaces the web's `<ReferenceLine>` overlay on Vico 2.0.
 */
data class ChartVerticalMarker(
    val index: Int,
    val label: String,
    val severity: MarkerSeverity = MarkerSeverity.Warn,
    val color: Color? = null,
    val id: String? = null,
)

/** A legend row: a color swatch + [label] bound to a series [key]. */
data class LegendEntry(
    val key: String,
    val label: String,
    val color: Color,
)

/** One row in a [ChartTooltipContent]: a colored [label] and its formatted [value]. */
data class ChartTooltipEntry(
    val label: String,
    val value: String,
    val color: Color,
)

/** The lifecycle a chart can be in. Drives `ChartContainer`'s body switch. */
enum class ChartStatus { Loading, Error, Empty, Ready }

/** A `(x, y)` sample in pixel space — output of the Canvas sparkline/mini-chart math. */
data class ChartPointF(
    val x: Float,
    val y: Float,
)
