package io.teslasync.android.components.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Tiny inline trend line with a soft gradient fill — the Android counterpart of the
 * web `Sparkline` (hand-drawn SVG, not a chart-library chart). Pure Compose Canvas:
 * no axes, no interaction, fits any compact slot. Renders nothing below two finite
 * samples. Geometry comes from the JVM-tested [sparklinePoints].
 */
@Composable
fun Sparkline(
    data: List<Double?>,
    modifier: Modifier = Modifier,
    color: Color = paletteColor(0),
    width: Dp = ChartDefaults.SparklineWidth,
    height: Dp = ChartDefaults.SparklineHeight,
    filled: Boolean = true,
) {
    Canvas(modifier = modifier.size(width, height)) {
        val points = sparklinePoints(data, size.width, size.height)
        if (points.size < 2) return@Canvas
        val linePath =
            Path().apply {
                moveTo(points.first().x, points.first().y)
                points.drop(1).forEach { lineTo(it.x, it.y) }
            }
        if (filled) {
            val areaPath =
                Path().apply {
                    addPath(linePath)
                    lineTo(points.last().x, size.height)
                    lineTo(points.first().x, size.height)
                    close()
                }
            drawPath(areaPath, brush = ChartGradient.verticalBrush(color))
        }
        drawPath(
            path = linePath,
            color = color,
            style = Stroke(width = STROKE_WIDTH.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}

private val STROKE_WIDTH = 1.5.dp
