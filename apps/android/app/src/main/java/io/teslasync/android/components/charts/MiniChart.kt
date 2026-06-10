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
 * Minimal inline trend line — the Android counterpart of the web `MiniChart`. Like
 * [Sparkline] but stroke-only (no fill), for the tightest table-cell / stat-tile
 * slots. Pure Compose Canvas; renders nothing below two finite samples.
 */
@Composable
fun MiniChart(
    data: List<Double?>,
    modifier: Modifier = Modifier,
    color: Color = paletteColor(0),
    width: Dp = ChartDefaults.SparklineWidth,
    height: Dp = ChartDefaults.SparklineHeight,
) {
    Canvas(modifier = modifier.size(width, height)) {
        val points = sparklinePoints(data, size.width, size.height, padding = PADDING.toPx())
        if (points.size < 2) return@Canvas
        val linePath =
            Path().apply {
                moveTo(points.first().x, points.first().y)
                points.drop(1).forEach { lineTo(it.x, it.y) }
            }
        drawPath(
            path = linePath,
            color = color,
            style = Stroke(width = STROKE_WIDTH.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}

private val STROKE_WIDTH = 1.5.dp
private val PADDING = 2.dp
