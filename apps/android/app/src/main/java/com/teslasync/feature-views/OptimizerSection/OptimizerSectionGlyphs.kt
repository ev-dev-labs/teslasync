// Locally-authored 24×24 stroked icons for the OptimizerSection feature view — the Android stand-ins for the
// web component's `lucide-react` glyphs (Calendar, DollarSign, Lightbulb, Shield, Clock). Android ships no
// lucide equivalent without the frozen `material-icons-extended` artifact, so this surface authors its own
// monochrome [ImageVector]s (recolored at render time by each section header's accent) — the same approach
// the sibling ChargingTab / DataDisplay glyph sets use. Kept self-contained to this surface so the glyphs
// never couple to another icon set.
//
// Each glyph is decorative — the localized section title carries the meaning — so every call site renders it
// with a `null` content description, keeping it out of the TalkBack reading order rather than announcing a
// redundant icon name.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OptimizerSection) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.optimizersection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The five monochrome line glyphs the section renders, one per header / recommendation accent. Authored as
 * 24×24 round-capped stroked vectors so each inherits the Material 3 content color (the section accent) in
 * every theme — light, dark, and high-contrast.
 */
object OptimizerSectionGlyphs {
    /** lucide `calendar` — a page with two top rings and a header rule (the Charging Habits header). */
    val Calendar: ImageVector =
        optimizerVector("OptimizerCalendar") {
            rect(4f, 5f, 20f, 20f)
            moveTo(8f, 2.5f)
            lineTo(8f, 5f)
            moveTo(16f, 2.5f)
            lineTo(16f, 5f)
            moveTo(4f, 9f)
            lineTo(20f, 9f)
        }

    /** lucide `dollar-sign` — a vertical bar threaded through an S (the Cost Analysis header + savings banner). */
    val DollarSign: ImageVector =
        optimizerVector("OptimizerDollarSign") {
            moveTo(12f, 2f)
            verticalLineTo(22f)
            moveTo(17f, 6f)
            horizontalLineTo(9.5f)
            arcToRelative(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, dx1 = 0f, dy1 = 7f)
            horizontalLineToRelative(5f)
            arcToRelative(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, dx1 = 0f, dy1 = 7f)
            horizontalLineTo(6f)
        }

    /** lucide `lightbulb` — a rounded bulb over a short base (the Recommendations header). */
    val Lightbulb: ImageVector =
        optimizerVector("OptimizerLightbulb") {
            moveTo(12f, 3f)
            curveTo(8.4f, 3f, 6f, 5.7f, 6f, 9f)
            curveTo(6f, 11.4f, 7.3f, 13.2f, 9f, 14.5f)
            lineTo(9f, 17f)
            lineTo(15f, 17f)
            lineTo(15f, 14.5f)
            curveTo(16.7f, 13.2f, 18f, 11.4f, 18f, 9f)
            curveTo(18f, 5.7f, 15.6f, 3f, 12f, 3f)
            close()
            moveTo(10f, 20f)
            lineTo(14f, 20f)
        }

    /** lucide `shield` — a crested badge outline (each recommendation card's leading icon). */
    val Shield: ImageVector =
        optimizerVector("OptimizerShield") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
        }

    /** lucide `clock` — a dial with two hands (the Cost Heatmap header). */
    val Clock: ImageVector =
        optimizerVector("OptimizerClock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }
}

/**
 * Builds a 24×24 round-capped, round-joined stroked [ImageVector] from a [PathBuilder] block — the one
 * authoring helper every glyph in this surface shares. The stroke is solid black so the rendering `Icon`'s
 * `tint` (the section accent) fully recolors it in every theme.
 */
private fun optimizerVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
