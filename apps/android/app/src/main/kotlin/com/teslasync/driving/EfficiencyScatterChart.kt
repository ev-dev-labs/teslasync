// A Compose-native Canvas scatter plot for the EfficiencyPage surface — the native counterpart of the web page's two
// recharts `<ScatterChart>`s (Speed-vs-Efficiency, Temperature-vs-Efficiency). The A3 chart library carries no scatter
// wrapper (its Vico presets are line/area/bar only), so — exactly as the sibling BatteryHealthPage authors its AC/DC
// donut as a Canvas — this surface draws the scatter itself with `Canvas` + `rememberTextMeasurer`, never a webview.
//
// Pure presentation: the page hands it the already-display-converted points + a design-token color; the cloud of
// filled dots is plotted over a faint grid with min/mid/max tick labels on each axis. The whole plot exposes one
// screen-reader description through the enclosing `ChartContainer` (the web `ariaLabel`), so the decorative dots stay
// out of the accessibility tree.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// point model.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.driving.efficiency

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.ui.Caption
import java.util.Locale

/** One plotted scatter sample in display units (web recharts `{ x, y }`). */
data class EfficiencyScatterPoint(val x: Double, val y: Double)

private val PLOT_HEIGHT = 220.dp
private val AXIS_LEFT_PAD = 40.dp
private val AXIS_BOTTOM_PAD = 18.dp
private val POINT_RADIUS = 4.dp
private const val GRID_ALPHA = 0.35f
private const val POINT_ALPHA = 0.6f
private const val AXIS_FONT_SP = 9f
private const val TICKS = 3
private const val DOMAIN_PAD_FRACTION = 0.08

/**
 * Draws a scatter cloud of [points] in [pointColor] over a faint cartesian grid sized to the data's domain, with
 * min/mid/max numeric ticks on each axis (formatted in [locale], with the optional [xUnit]/[yUnit] suffix on the axis
 * extremes). An empty [points] list renders nothing — the caller's `ChartContainer` shows the empty state instead, so a
 * section is never a blank box.
 */
@Composable
fun EfficiencyScatterChart(
    points: List<EfficiencyScatterPoint>,
    pointColor: Color,
    modifier: Modifier = Modifier,
    height: Dp = PLOT_HEIGHT,
    xUnit: String = "",
    yUnit: String = "",
    xAxisName: String = "",
    yAxisName: String = "",
    locale: Locale = Locale.getDefault(),
) {
    if (points.isEmpty()) return
    val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = GRID_ALPHA)
    val axisColor = MaterialTheme.colorScheme.outlineVariant
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant
    val dotColor = pointColor.copy(alpha = POINT_ALPHA)
    val measurer = rememberTextMeasurer()
    val labelStyle = TextStyle(color = labelColor, fontSize = AXIS_FONT_SP.sp)

    val (minX, maxX) = paddedDomain(points.map { it.x })
    val (minY, maxY) = paddedDomain(points.map { it.y })

    Column(modifier = modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        if (yAxisName.isNotBlank()) Caption(yAxisName, modifier = Modifier.fillMaxWidth())
        Canvas(modifier = Modifier.fillMaxWidth().height(height)) {
        val leftPad = AXIS_LEFT_PAD.toPx()
        val bottomPad = AXIS_BOTTOM_PAD.toPx()
        val plotLeft = leftPad
        val plotTop = 0f
        val plotRight = size.width
        val plotBottom = size.height - bottomPad
        val plotWidth = (plotRight - plotLeft).coerceAtLeast(1f)
        val plotHeight = (plotBottom - plotTop).coerceAtLeast(1f)

        // Grid + axis ticks.
        for (i in 0..TICKS) {
            val fraction = i.toFloat() / TICKS
            val y = plotTop + plotHeight * fraction
            drawLine(gridColor, Offset(plotLeft, y), Offset(plotRight, y), strokeWidth = 1f)
            val yValue = maxY - (maxY - minY) * fraction
            val text = ChartFormat.withUnit(yValue, yUnit.takeIf { i == 0 }, 0, locale)
            val measured = measurer.measure(text, labelStyle)
            drawText(
                measured,
                topLeft = Offset((plotLeft - measured.size.width - 4f).coerceAtLeast(0f), (y - measured.size.height / 2f).coerceAtLeast(0f)),
            )

            val x = plotLeft + plotWidth * fraction
            drawLine(gridColor, Offset(x, plotTop), Offset(x, plotBottom), strokeWidth = 1f)
            val xValue = minX + (maxX - minX) * fraction
            val xText = ChartFormat.withUnit(xValue, xUnit.takeIf { i == TICKS }, 0, locale)
            val measuredX = measurer.measure(xText, labelStyle)
            drawText(
                measuredX,
                topLeft = Offset((x - measuredX.size.width / 2f).coerceIn(0f, size.width - measuredX.size.width), plotBottom + 2f),
            )
        }

        // Axis baselines.
        drawLine(axisColor, Offset(plotLeft, plotBottom), Offset(plotRight, plotBottom), strokeWidth = 1.5f)
        drawLine(axisColor, Offset(plotLeft, plotTop), Offset(plotLeft, plotBottom), strokeWidth = 1.5f)

        // Points.
        val radius = POINT_RADIUS.toPx()
        val spanX = (maxX - minX).takeIf { it != 0.0 } ?: 1.0
        val spanY = (maxY - minY).takeIf { it != 0.0 } ?: 1.0
        points.forEach { point ->
            val px = plotLeft + ((point.x - minX) / spanX).toFloat() * plotWidth
            val py = plotBottom - ((point.y - minY) / spanY).toFloat() * plotHeight
            drawCircle(dotColor, radius = radius, center = Offset(px, py))
        }
        }
        if (xAxisName.isNotBlank()) Caption(xAxisName)
    }
}

/** A [min, max] domain padded by [DOMAIN_PAD_FRACTION] so points never sit on the axis; a flat series widens by ±1. */
private fun paddedDomain(values: List<Double>): Pair<Double, Double> {
    val lo = values.minOrNull() ?: 0.0
    val hi = values.maxOrNull() ?: 0.0
    if (lo == hi) return (lo - 1.0) to (hi + 1.0)
    val pad = (hi - lo) * DOMAIN_PAD_FRACTION
    return (lo - pad) to (hi + pad)
}
