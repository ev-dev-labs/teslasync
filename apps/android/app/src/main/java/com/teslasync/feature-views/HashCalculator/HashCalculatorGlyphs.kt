// Locally-authored 24×24 stroked icon for the Hash Calculator surface — the Android stand-in for the web
// tool's `lucide-react` `Hash` glyph (the `#` mark). Android ships no lucide equivalent, so the surface
// authors its own monochrome [ImageVector] (recolored at render time by `Icon`'s `tint`) — the same approach
// the sibling client-utility surfaces and dashboard widgets use. Kept self-contained to this surface so the
// glyph never couples to another surface's icon set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HashCalculator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.hashcalculator

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The icon the surface renders in its tool-card chip and empty state — lucide `Hash`, the `#` mark: two
 * vertical strokes crossed by two horizontal strokes, authored as a 24×24 round-capped stroked vector so it
 * inherits the Material 3 content color in every theme. Purely decorative (the card title carries the
 * meaning), so it is rendered with a `null` content description at every call site.
 */
object HashCalculatorGlyphs {
    /** lucide `Hash` — the `#` glyph (the Hash Calculator tool icon). */
    val Hash: ImageVector =
        ImageVector
            .Builder(
                name = "Hash",
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
                    moveTo(9f, 4f)
                    lineTo(7f, 20f)
                    moveTo(17f, 4f)
                    lineTo(15f, 20f)
                    moveTo(5f, 9f)
                    lineTo(19f, 9f)
                    moveTo(5f, 15f)
                    lineTo(19f, 15f)
                }
            }.build()
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
