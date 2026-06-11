package io.teslasync.android.components.motion

import android.content.Context
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.MotionEasing

/*
 * Reduced-motion plumbing + framework-free motion math for the motion layer, the Android
 * counterpart of the web `useMotionPreference` hook. The pure helpers (`effectiveDurationMs`,
 * `staggerDelayMs`) are JVM-unit-tested; the composables read the platform animator scale
 * (Android's `prefers-reduced-motion` equivalent) or a deterministic [LocalReducedMotion]
 * override used by previews and instrumented tests.
 */

/**
 * Forces the reduced-motion answer for everything below it. `null` (the default) means
 * "ask the platform". Previews/tests provide `true`/`false` for a deterministic clock so
 * motion assertions never depend on the host device's animator setting.
 */
val LocalReducedMotion = staticCompositionLocalOf<Boolean?> { null }

/** Shared durations / easings for the motion primitives, sourced from the P3/A1 tokens. */
object MotionDefaults {
    const val FADE_MS: Int = MotionDurations.normal
    const val ITEM_MS: Int = MotionDurations.normal
    const val STAGGER_STEP_MS: Int = 60
    const val TRANSITION_MS: Int = MotionDurations.fast
    const val SLIDE_DP: Int = 12

    val enter = MotionEasing.decelerate
    val standard = MotionEasing.standard
    val exit = MotionEasing.accelerate
}

/** Requested duration, collapsed to 0 when reduced motion is requested (web `durationMs`). */
fun effectiveDurationMs(
    reduce: Boolean,
    requestedMs: Int,
): Int = if (reduce) 0 else requestedMs.coerceAtLeast(0)

/**
 * Entrance delay for the child at [index] in a stagger, at [stepMs] cadence. The first item
 * (index 0) and every item under reduced motion start immediately.
 */
fun staggerDelayMs(
    index: Int,
    stepMs: Int,
    reduce: Boolean,
): Int = if (reduce || index <= 0) 0 else index * stepMs.coerceAtLeast(0)

/**
 * The active reduced-motion preference: the [LocalReducedMotion] override when set, otherwise
 * `true` when the OS animator duration scale is 0 (TalkBack "remove animations" / developer
 * "animator duration scale = off").
 */
@Composable
fun rememberReducedMotion(): Boolean {
    val override = LocalReducedMotion.current
    if (override != null) return override
    val context = LocalContext.current
    return remember(context) { systemAnimationsDisabled(context) }
}

/** Convenience: the effective transition duration honoring the active reduced-motion preference. */
@Composable
fun rememberMotionDurationMs(requestedMs: Int = MotionDefaults.FADE_MS): Int = effectiveDurationMs(rememberReducedMotion(), requestedMs)

private fun systemAnimationsDisabled(context: Context): Boolean {
    val scale =
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        )
    return scale == 0f
}
