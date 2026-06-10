package io.teslasync.android.components.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Circular progress gauge — the Android counterpart of the web `RadialGauge`. A
 * rounded arc swept proportionally to `value/max` over a track ring, with the value
 * (and optional unit) centered and a [label] below. Pure Compose Canvas; the sweep
 * fraction comes from the JVM-tested [gaugeFraction]. The whole gauge exposes one
 * screen-reader description instead of the decorative arcs.
 */
@Composable
fun RadialGauge(
    value: Double,
    max: Double,
    label: String,
    modifier: Modifier = Modifier,
    unit: String? = null,
    color: Color = paletteColor(0),
    size: Dp = ChartDefaults.GaugeSize,
    decimals: Int = 0,
) {
    val fraction = gaugeFraction(value, max)
    val trackColor = MaterialTheme.colorScheme.surfaceVariant
    val valueText = ChartFormat.withUnit(value, unit, decimals)
    Column(
        modifier =
            modifier.clearAndSetSemantics {
                contentDescription = "$label: $valueText"
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.size(size)) {
                val strokePx = STROKE_WIDTH.toPx()
                val diameter = this.size.minDimension - strokePx
                val topLeft =
                    Offset(
                        (this.size.width - diameter) / 2f,
                        (this.size.height - diameter) / 2f,
                    )
                val arcSize = Size(diameter, diameter)
                drawArc(
                    color = trackColor,
                    startAngle = START_ANGLE,
                    sweepAngle = FULL_SWEEP,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokePx, cap = androidx.compose.ui.graphics.StrokeCap.Round),
                )
                drawArc(
                    color = color,
                    startAngle = START_ANGLE,
                    sweepAngle = FULL_SWEEP * fraction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokePx, cap = androidx.compose.ui.graphics.StrokeCap.Round),
                )
            }
            MetricValue(valueText)
        }
        MetricLabel(label)
    }
}

private val STROKE_WIDTH = 8.dp
private const val START_ANGLE = -90f
private const val FULL_SWEEP = 360f
