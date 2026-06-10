package io.teslasync.android.components.charts

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/**
 * Area-fill gradient tokens, the Android counterpart of the web `ChartGradient` /
 * `areaGradient` helpers: a top-down fade from a translucent series color to near
 * transparent. Used by the Canvas visuals (`Sparkline`, `ElevationProfile`) and as
 * the source for Vico area fills, so every filled area shares one ramp.
 */
object ChartGradient {
    /** Opacity at the top of the fill (just under the line). */
    const val TOP_ALPHA: Float = 0.30f

    /** Opacity at the baseline of the fill. */
    const val BOTTOM_ALPHA: Float = 0.02f

    /** A top-to-bottom [Brush] fading [color] from [TOP_ALPHA] to [BOTTOM_ALPHA]. */
    fun verticalBrush(
        color: Color,
        topAlpha: Float = TOP_ALPHA,
        bottomAlpha: Float = BOTTOM_ALPHA,
    ): Brush =
        Brush.verticalGradient(
            listOf(color.copy(alpha = topAlpha), color.copy(alpha = bottomAlpha)),
        )

    /** A flat translucent variant of [color] for Vico's single-color area fill. */
    fun solid(
        color: Color,
        alpha: Float = TOP_ALPHA,
    ): Color = color.copy(alpha = alpha)
}
