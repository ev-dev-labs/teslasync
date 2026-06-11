// Locally-authored 24×24 stroked icons for the XRayHeader surface — the Android stand-ins for two of the
// three web `lucide-react` glyphs the strip uses (`Activity` and `Layers`; the third, `Clock`, is taken
// from the shared `DataDisplayGlyphs`). Android ships no lucide equivalent without pulling the frozen
// `material-icons-extended` artifact, so the surface authors its own monochrome [ImageVector]s (recolored
// at render time by the shared `Icon`'s `tint`) — the same approach the sibling TimestampTool and
// ClientUtilitiesSection surfaces take. Authoring them here keeps the surface self-contained within its
// allowed-files directory rather than coupling it to another feature's glyph set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/XRayHeader) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xrayheader

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The two glyphs the XRayHeader references directly, authored as 24×24 round-capped stroked vectors so
 * they inherit the Material 3 content color in every theme. Both are decorative — each card's label and
 * value carry the meaning — so they are rendered with a `null` content description at the call site.
 */
object XRayHeaderGlyphs {
    /** lucide `Activity` — the pulse/heartbeat polyline (the "Total samples" card icon). */
    val Activity: ImageVector =
        glyph("XRayHeaderActivity") {
            moveTo(2f, 12f)
            lineTo(6f, 12f)
            lineTo(9f, 21f)
            lineTo(15f, 3f)
            lineTo(18f, 12f)
            lineTo(22f, 12f)
        }

    /** lucide `Layers` — a stacked-sheets diamond with two layers beneath (the "Distinct fields" card icon). */
    val Layers: ImageVector =
        glyph("XRayHeaderLayers") {
            moveTo(12f, 3f)
            lineTo(21f, 8f)
            lineTo(12f, 13f)
            lineTo(3f, 8f)
            close()
            moveTo(3f, 12f)
            lineTo(12f, 17f)
            lineTo(21f, 12f)
            moveTo(3f, 16f)
            lineTo(12f, 21f)
            lineTo(21f, 16f)
        }
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
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
                pathBuilder = pathBuilder,
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
