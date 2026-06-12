// Self-contained line-style icon set for the SuggestedPrompts surface, drawn as a Material [ImageVector].
//
// The web component uses the `lucide-react` `Sparkles` glyph (`<Sparkles className="h-3.5 w-3.5" />`) as each
// chip's leading icon. The shared `TeslaGlyphs` / `DataDisplayGlyphs` sets ship no sparkle/twinkle glyph, and
// Android ships no lucide-equivalent set without the frozen `material-icons-extended` artifact. So — exactly as
// the sibling DrivingTips surface authors its Lightbulb / ShieldCheck — the one glyph this surface needs is
// authored here as a 24×24 stroked vector. It is monochrome (drawn in opaque black) and recolored at render
// time by the [io.teslasync.android.components.ui.Icon] composable's `tint`, so it inherits each chip's ghost
// content color automatically (the web resting state, where the icon takes the button's text color).
//
// Composition mirrors lucide `sparkles`: one prominent four-point twinkle plus two small "plus" sparkles in the
// opposite clear corners (lucide draws the small ones as plus marks, not stars). The twinkle is an eight-vertex
// star (four outer points on the axes, four inner valleys on the diagonals); the corners are left clear so the
// plus marks never collide with the star's on-axis points.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SuggestedPrompts) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.suggestedprompts

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyph the SuggestedPrompts surface renders. */
internal object SuggestedPromptsGlyphs {
    /**
     * lucide `sparkles` — each suggestion chip's leading icon: a large four-point twinkle with two small plus
     * sparkles in the upper-right and lower-left corners.
     */
    val Sparkles: ImageVector =
        stroked("Sparkles") {
            // Large four-point twinkle, centered at (12, 12): outer points on the axes (R = 8.5), inner
            // valleys on the diagonals (r = 3.0). Traced clockwise from the top point.
            fourPointStar(cx = 12f, cy = 12f, outer = 8.5f, inner = 3.0f)
            // Small plus sparkle, upper-right clear corner.
            plus(cx = 18.5f, cy = 6f, arm = 1.5f)
            // Small plus sparkle, lower-left clear corner.
            plus(cx = 5.5f, cy = 18f, arm = 1.5f)
        }
}

private fun stroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Diagonal projection of an inner valley: `r / sqrt(2)`, so a valley sits at (cx ± d, cy ± d). */
private const val DIAGONAL = 0.70710677f

/**
 * Traces an eight-vertex four-point star ("twinkle"): outer points at the [outer] radius on the four axes and
 * inner valleys at the [inner] radius on the four diagonals, centered at ([cx], [cy]). Drawn clockwise from the
 * top point and closed.
 */
private fun PathBuilder.fourPointStar(
    cx: Float,
    cy: Float,
    outer: Float,
    inner: Float,
) {
    val d = inner * DIAGONAL
    moveTo(cx, cy - outer)
    lineTo(cx + d, cy - d)
    lineTo(cx + outer, cy)
    lineTo(cx + d, cy + d)
    lineTo(cx, cy + outer)
    lineTo(cx - d, cy + d)
    lineTo(cx - outer, cy)
    lineTo(cx - d, cy - d)
    close()
}

/** Draws a small plus mark ("+") centered at ([cx], [cy]) with arms of length [arm] on each side. */
private fun PathBuilder.plus(
    cx: Float,
    cy: Float,
    arm: Float,
) {
    moveTo(cx, cy - arm)
    lineTo(cx, cy + arm)
    moveTo(cx - arm, cy)
    lineTo(cx + arm, cy)
}
