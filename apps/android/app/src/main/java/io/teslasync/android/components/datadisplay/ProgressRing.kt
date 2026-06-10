package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Circular progress ring with an optional centered label — the Android counterpart of the web
 * `ProgressRing`. Draws a token-colored track + progress arc on a [Canvas]; [centerLabel] /
 * [centerSubLabel] sit inside the ring, [label] below it.
 */
@Composable
fun ProgressRing(
    value: Double,
    modifier: Modifier = Modifier,
    max: Double = 100.0,
    size: Dp = 48.dp,
    strokeWidth: Dp = 4.dp,
    color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    centerLabel: String? = null,
    centerSubLabel: String? = null,
    label: String? = null,
    contentDescription: String? = null,
) {
    val fraction = if (max > 0.0) (value / max).coerceIn(0.0, 1.0).toFloat() else 0f
    Column(
        modifier =
            modifier.then(
                if (contentDescription != null) {
                    Modifier.clearAndSetSemantics { this.contentDescription = contentDescription }
                } else {
                    Modifier
                },
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Box(modifier = Modifier.size(size), contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.size(size)) {
                val stroke = Stroke(width = strokeWidth.toPx(), cap = StrokeCap.Round)
                val inset = strokeWidth.toPx() / 2f
                val arcSize =
                    androidx.compose.ui.geometry.Size(
                        this.size.width - strokeWidth.toPx(),
                        this.size.height - strokeWidth.toPx(),
                    )
                val topLeft =
                    androidx.compose.ui.geometry
                        .Offset(inset, inset)
                drawArc(
                    color = trackColor,
                    startAngle = 0f,
                    sweepAngle = FULL_SWEEP,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = stroke,
                )
                drawArc(
                    color = color,
                    startAngle = START_ANGLE,
                    sweepAngle = FULL_SWEEP * fraction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = stroke,
                )
            }
            if (centerLabel != null || centerSubLabel != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (centerLabel != null) {
                        Text(
                            centerLabel,
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    if (centerSubLabel != null) {
                        Text(
                            centerSubLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        if (label != null) Caption(label)
    }
}

private const val FULL_SWEEP = 360f
private const val START_ANGLE = -90f
