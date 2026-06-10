// AUTO-GENERATED from apps/design/tokens.json by the :android generateDesignTokens task.
// DO NOT EDIT BY HAND. Regenerate with `./gradlew :android:generateDesignTokens`;
// `./gradlew :android:checkDesignTokensDrift` fails the build on drift (P3/A1).

package io.teslasync.android.ui.theme.generated

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing

// Motion durations in milliseconds.
object MotionDurations {
    const val fast: Int = 150
    const val normal: Int = 250
    const val slow: Int = 400
}

// Motion easing curves built from the token cubic-bezier control points.
object MotionEasing {
    val standard: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val accelerate: Easing = CubicBezierEasing(0.3f, 0f, 1f, 1f)
    val decelerate: Easing = CubicBezierEasing(0f, 0f, 0f, 1f)
}
