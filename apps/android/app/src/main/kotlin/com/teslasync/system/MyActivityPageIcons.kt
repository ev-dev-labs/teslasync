// Locally-authored stroked vector glyphs for the MyActivityPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/system/pages/MyActivityPage.tsx uses the `Icons.securityCheck`
// = ShieldCheck, `Icons.user` = User, and `Icons.warning` = AlertTriangle markers for its three explanatory
// states). The shared icon catalog (TeslaGlyphs) ships none of these page glyphs and editing it is outside this
// surface's allowed files, so they are authored here as 24×24 monochrome stroked vectors and recolored at render
// via the `Icon` tint — exactly the approach the sibling A7 page surfaces document (TeslaAccountPageIcons,
// CommandsPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.myactivity

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
 * The glyph set this surface needs (the web MyActivityPage lucide icons). Each is a monochrome 24×24 stroked
 * vector recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color
 * automatically.
 */
object MyActivityGlyphs {
    /** Shield-check — web `Icons.securityCheck` (the "Activity feed disabled" 503 state). A shield with a tick. */
    val ShieldCheck: ImageVector =
        strokedGlyph("MyActivityShieldCheck") {
            moveTo(12f, 3f)
            lineTo(20f, 6f)
            lineTo(20f, 11f)
            curveTo(20f, 16f, 16.5f, 19.5f, 12f, 21f)
            curveTo(7.5f, 19.5f, 4f, 16f, 4f, 11f)
            lineTo(4f, 6f)
            close()
            moveTo(8.5f, 12f)
            lineTo(11f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** User — web `Icons.user` (the "Identity required" 401 state). A head circle over a shoulders curve. */
    val User: ImageVector =
        strokedGlyph("MyActivityUser") {
            glyphCircle(12f, 8f, 3.5f)
            moveTo(5f, 20f)
            curveTo(5f, 16f, 8f, 14f, 12f, 14f)
            curveTo(16f, 14f, 19f, 16f, 19f, 20f)
        }

    /** Alert-triangle — web `Icons.warning` (the "Could not load activity" error state). A triangle with a bang. */
    val Warning: ImageVector =
        strokedGlyph("MyActivityWarning") {
            moveTo(12f, 3.5f)
            lineTo(21.5f, 20f)
            lineTo(2.5f, 20f)
            close()
            moveTo(12f, 9f)
            lineTo(12f, 14f)
            moveTo(12f, 17f)
            lineTo(12f, 17.1f)
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
