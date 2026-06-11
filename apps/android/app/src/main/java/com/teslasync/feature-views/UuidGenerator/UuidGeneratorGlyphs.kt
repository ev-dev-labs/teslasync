// Locally-authored 24×24 stroked icon for the UUID Generator surface — the Android stand-in for the web
// tool's `lucide-react` `Fingerprint` glyph (the tool-card icon). Android ships no lucide equivalent, so the
// surface authors its own monochrome [ImageVector] (recolored at render time by `Icon`'s `tint`) — the same
// approach the sibling ColorConverter / HashCalculator surfaces use. Kept self-contained to this surface so
// the glyph never couples to another surface's icon set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UuidGenerator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.uuidgenerator

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The icon the surface renders in its tool-card chip — lucide `Fingerprint`: a set of nested ridge arcs over
 * descending tails. Authored as a 24×24 round-capped stroked vector so it inherits the Material 3 content
 * color in every theme. Purely decorative (the card title carries the meaning), so it is rendered with a
 * `null` content description at every call site.
 */
object UuidGeneratorGlyphs {
    /** lucide `Fingerprint` — nested ridge arcs (the UUID Generator tool icon). */
    val Fingerprint: ImageVector =
        ImageVector
            .Builder(
                name = "Fingerprint",
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
                ) {
                    // Outer ridge (top arch).
                    moveTo(3.5f, 12f)
                    arcTo(8.5f, 8.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 20.5f, y1 = 12f)
                    // Middle ridge.
                    moveTo(6.5f, 12f)
                    arcTo(5.5f, 5.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 17.5f, y1 = 12f)
                    // Inner whorl.
                    moveTo(9.5f, 12f)
                    arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 14.5f, y1 = 12f)
                    // Descending ridge tails.
                    moveTo(20.5f, 12f)
                    lineTo(20.5f, 14.5f)
                    moveTo(17.5f, 12f)
                    lineTo(17.5f, 16.5f)
                    moveTo(14.5f, 12f)
                    lineTo(14.5f, 18f)
                    moveTo(6.5f, 12f)
                    lineTo(6.5f, 15f)
                }
            }.build()
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
