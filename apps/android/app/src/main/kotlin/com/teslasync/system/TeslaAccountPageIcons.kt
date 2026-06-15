// Locally-authored stroked vector glyphs for the TeslaAccountPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/system/pages/TeslaAccountPage.tsx imports RefreshCw, User,
// ImageOff). The shared icon catalog (TeslaGlyphs) ships none of these page glyphs and editing it is outside
// this surface's allowed files, so they are authored here as 24×24 monochrome stroked vectors and recolored at
// render via the `Icon` tint — exactly the approach the sibling A7 page surfaces document (CommandsPageIcons,
// the RegionSettings feature view's local Globe/Refresh glyphs).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.teslaaccount

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
 * The glyph set this surface needs (the web TeslaAccountPage lucide icons). Each is a monochrome 24×24 stroked
 * vector recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color
 * automatically.
 */
object TeslaAccountGlyphs {
    /** Refresh — web `RefreshCw` (the Refresh action + the spinning sync indicator). A circular refresh arrow. */
    val Refresh: ImageVector =
        strokedGlyph("TeslaAccountRefresh") {
            moveTo(21f, 12f)
            arcToRelative(9f, 9f, 0f, true, true, -9f, -9f)
            arcToRelative(9.75f, 9.75f, 0f, false, true, 6.74f, 2.74f)
            lineTo(21f, 8f)
            moveTo(21f, 3f)
            verticalLineToRelative(5f)
            horizontalLineToRelative(-5f)
        }

    /** User — web `User` (the no-profile empty state). A head circle over a shoulders curve. */
    val User: ImageVector =
        strokedGlyph("TeslaAccountUser") {
            glyphCircle(12f, 8f, 3.5f)
            moveTo(5f, 20f)
            curveTo(5f, 16f, 8f, 14f, 12f, 14f)
            curveTo(16f, 14f, 19f, 16f, 19f, 20f)
        }

    /** Image-off — web `ImageOff` (the no-image avatar frame). An image frame + mountain + sun crossed by a slash. */
    val ImageOff: ImageVector =
        strokedGlyph("TeslaAccountImageOff") {
            moveTo(3f, 5f)
            lineTo(21f, 5f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(3f, 16f)
            lineTo(8f, 11f)
            lineTo(12f, 15f)
            glyphCircle(15.5f, 9f, 1.3f)
            moveTo(3f, 3f)
            lineTo(21f, 21f)
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
