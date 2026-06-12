// The two stroked vectors this surface needs that the shared icon sets do not provide: the [Plug] (the
// Charges tile, web lucide `Plug`) and the [Leaf] (the CO₂-saved tile, web lucide `Leaf`). The Drives +
// distance tiles reuse the shared `NavGlyphs.Car` and the energy tile reuses `DataDisplayGlyphs.Bolt`
// (web `Zap`), so only these two are authored here — as 24×24 monochrome vectors recolored at render time
// by `Icon`'s tint, the same approach the bundled `DataDisplayGlyphs` / `NavGlyphs` sets use, since
// Android ships no lucide equivalent without the frozen `material-icons-extended` artifact.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummarySlide) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.summaryslide

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

// Authored glyph geometry (the curated icon sets have no plug / leaf analogue).
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/** Corner radius of the plug body's rounded base, in viewport units (lucide `Plug` a4 4 arcs). */
private const val PLUG_CORNER_RADIUS = 4f

/** The leading glyphs SummarySlide authors itself: the [Plug] (Charges) and [Leaf] (CO₂ saved) tiles. */
internal object SummarySlideGlyphs {
    val Plug: ImageVector =
        glyph("Plug") {
            // Cord dropping from the socket body (lucide `M12 22v-5`).
            moveTo(12f, 22f)
            lineTo(12f, 17f)
            // Left + right prongs (lucide `M9 8V2`, `M15 8V2`).
            moveTo(9f, 8f)
            lineTo(9f, 2f)
            moveTo(15f, 8f)
            lineTo(15f, 2f)
            // Socket body with the rounded base (lucide `M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z`).
            moveTo(18f, 8f)
            lineTo(18f, 13f)
            arcTo(PLUG_CORNER_RADIUS, PLUG_CORNER_RADIUS, 0f, false, true, 14f, 17f)
            lineTo(10f, 17f)
            arcTo(PLUG_CORNER_RADIUS, PLUG_CORNER_RADIUS, 0f, false, true, 6f, 13f)
            lineTo(6f, 8f)
            close()
        }

    val Leaf: ImageVector =
        glyph("Leaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14f, 10f)
        }
}

private fun glyph(
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
