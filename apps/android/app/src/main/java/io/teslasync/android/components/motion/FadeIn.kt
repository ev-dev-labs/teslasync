package io.teslasync.android.components.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Fades its [content] in with a short slide-up, the Android counterpart of the web `FadeIn`.
 * Honors reduced motion ([rememberReducedMotion]): when motion is reduced the content renders
 * in its final state immediately with no entry animation. [delayMs] lets callers hand-stagger
 * a few siblings; for lists prefer [StaggerContainer] + [StaggerItem].
 */
@Composable
fun FadeIn(
    modifier: Modifier = Modifier,
    delayMs: Int = 0,
    durationMs: Int = MotionDefaults.FADE_MS,
    content: @Composable () -> Unit,
) {
    val reduce = rememberReducedMotion()
    val progress = remember { Animatable(if (reduce) 1f else 0f) }
    val slidePx = with(LocalDensity.current) { MotionDefaults.SLIDE_DP.dp.toPx() }
    LaunchedEffect(reduce, durationMs, delayMs) {
        if (reduce) {
            progress.snapTo(1f)
        } else {
            progress.snapTo(0f)
            if (delayMs > 0) delay(delayMs.toLong())
            progress.animateTo(1f, tween(durationMs.coerceAtLeast(1), easing = MotionDefaults.enter))
        }
    }
    Box(
        modifier =
            modifier.graphicsLayer {
                alpha = progress.value
                translationY = (1f - progress.value) * slidePx
            },
    ) {
        content()
    }
}
