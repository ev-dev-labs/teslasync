// Locally-authored stroked vector glyphs for the StatusApiDocsPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/system/pages/StatusApiDocsPage.tsx imports Server, ArrowLeft,
// Code). The shared icon catalog (TeslaGlyphs) ships none of these page glyphs and editing it is outside this
// surface's allowed files, so they are authored here as 24×24 monochrome stroked vectors and recolored at render
// via the `Icon` tint — exactly the approach the sibling A7 page surfaces document (RoadmapPageIcons,
// CommandHistoryPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.statusapidocs

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The glyph set this surface needs (the web StatusApiDocsPage lucide icons). Each is a monochrome 24×24 stroked
 * vector recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object StatusApiDocsGlyphs {
    /** Server — web `Server` (the Overview panel heading). Two stacked rack units, each with a status LED. */
    val Server: ImageVector =
        strokedGlyph("StatusApiDocsServer") {
            glyphRect(3f, 3f, 18f, 8f)
            glyphRect(3f, 13f, 18f, 8f)
            moveTo(6.5f, 7f)
            lineTo(7.5f, 7f)
            moveTo(6.5f, 17f)
            lineTo(7.5f, 17f)
        }

    /** Left arrow — web `ArrowLeft` (the "Back to System Status" action). A shaft with a chevron head. */
    val ArrowLeft: ImageVector =
        strokedGlyph("StatusApiDocsArrowLeft") {
            moveTo(19f, 12f)
            lineTo(5f, 12f)
            moveTo(12f, 19f)
            lineTo(5f, 12f)
            lineTo(12f, 5f)
        }

    /** Code — web `Code` (the additive-contract note + the page's developer affordance). The `</>` brackets. */
    val Code: ImageVector =
        strokedGlyph("StatusApiDocsCode") {
            moveTo(16f, 18f)
            lineTo(22f, 12f)
            lineTo(16f, 6f)
            moveTo(8f, 6f)
            lineTo(2f, 12f)
            lineTo(8f, 18f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the stroke color is replaced by the `Icon` tint at render. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
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

/** Draws an axis-aligned rectangle of [w]×[h] with its top-left corner at ([x], [y]). */
private fun PathBuilder.glyphRect(
    x: Float,
    y: Float,
    w: Float,
    h: Float,
) {
    moveTo(x, y)
    lineTo(x + w, y)
    lineTo(x + w, y + h)
    lineTo(x, y + h)
    close()
}
