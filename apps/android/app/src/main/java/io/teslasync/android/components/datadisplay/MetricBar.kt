package io.teslasync.android.components.datadisplay

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Animated horizontal bar that fills proportionally to [value] / [max] — the Android counterpart
 * of the web `MetricBar`. The [label] sits left, the [valueText] right (defaults to the formatted
 * value, tinted with [color]). The fill animates its width on value change.
 */
@Composable
fun MetricBar(
    value: Double,
    max: Double,
    label: String,
    modifier: Modifier = Modifier,
    valueText: String? = null,
    color: Color = MaterialTheme.colorScheme.primary,
) {
    val fraction = if (max > 0.0) (value / max).coerceIn(0.0, 1.0).toFloat() else 0f
    val animated by animateFloatAsState(
        targetValue = fraction,
        animationSpec = tween(MotionDurations.slow),
        label = "metric-bar-fill",
    )
    Column(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Caption(label)
            Text(
                text = valueText ?: ChartFormat.number(value),
                style = MaterialTheme.typography.labelMedium,
                color = color,
            )
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(animated)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(color),
            )
        }
    }
}

private val BAR_HEIGHT = 8.dp
