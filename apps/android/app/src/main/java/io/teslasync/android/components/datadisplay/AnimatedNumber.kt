package io.teslasync.android.components.datadisplay

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.ui.theme.generated.MotionDurations
import java.util.Locale

/**
 * Count-up number that animates from 0 to [value] on first composition and tweens to each new
 * value thereafter — the Android counterpart of the web `AnimatedNumber`. Formatting reuses the
 * shared [ChartFormat] so grouping/decimals match charts and tables.
 */
@Composable
fun AnimatedNumber(
    value: Double,
    modifier: Modifier = Modifier,
    decimals: Int = 0,
    prefix: String = "",
    suffix: String = "",
    durationMillis: Int = MotionDurations.slow,
    locale: Locale = Locale.getDefault(),
) {
    val animated = remember { Animatable(0f) }
    LaunchedEffect(value, durationMillis) {
        animated.animateTo(value.toFloat(), animationSpec = tween(durationMillis, easing = FastOutSlowInEasing))
    }
    // Animatable.value is snapshot-state backed, so reading it here recomposes each frame.
    MetricValue("$prefix${ChartFormat.number(animated.value * 1.0, decimals, locale)}$suffix", modifier)
}
