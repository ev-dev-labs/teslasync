package io.teslasync.android.components.motion

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A child of [StaggerContainer] whose entrance is delayed by its ordinal [index] so siblings
 * animate in sequence. The Android counterpart of the web `StaggerItem`. The delay comes from
 * the tested [staggerDelayMs]; under reduced motion every item starts immediately. Pass the
 * item's position (e.g. the `forEachIndexed` index) so the order is deterministic.
 */
@Composable
fun StaggerItem(
    index: Int,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val spec = LocalStaggerSpec.current
    val reduce = spec?.reduce ?: rememberReducedMotion()
    val step = spec?.stepMs ?: MotionDefaults.STAGGER_STEP_MS
    val duration = spec?.itemDurationMs ?: MotionDefaults.ITEM_MS
    FadeIn(
        modifier = modifier,
        delayMs = staggerDelayMs(index, step, reduce),
        durationMs = duration,
    ) {
        content()
    }
}
