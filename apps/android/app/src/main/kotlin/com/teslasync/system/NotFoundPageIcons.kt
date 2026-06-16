// Locally-authored stroked vector glyphs for the NotFoundPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/system/pages/NotFoundPage.tsx imports Compass, ArrowLeft, Home, Search).
// The shared icon catalog (TeslaGlyphs) ships none of these page glyphs and editing it is outside this surface's
// allowed files, so they are authored here as 24×24 monochrome stroked vectors and recolored at render via the `Icon`
// tint — exactly the approach the sibling A7 page surfaces document (RoadmapPageIcons, CommandsPageIcons,
// GlancePageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.notfound

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
 * The glyph set this surface needs (the web NotFoundPage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically: the
 * page's lead [Compass], and the three escape-hatch action glyphs ([ArrowLeft] back, [Home] dashboard, [Search]
 * command palette).
 */
object NotFoundGlyphs {
    /** Compass — web `Compass` (the page's centered lead glyph). A ringed face with the diamond needle. */
    val Compass: ImageVector =
        strokedGlyph("NotFoundCompass") {
            glyphCircle(12f, 12f, 10f)
            moveTo(16.24f, 7.76f)
            lineTo(14.12f, 14.12f)
            lineTo(7.76f, 16.24f)
            lineTo(9.88f, 9.88f)
            close()
        }

    /** Arrow-left — web `ArrowLeft` ("Go back" button). A shaft with a left-pointing head. */
    val ArrowLeft: ImageVector =
        strokedGlyph("NotFoundArrowLeft") {
            moveTo(19f, 12f)
            lineTo(5f, 12f)
            moveTo(12f, 19f)
            lineTo(5f, 12f)
            lineTo(12f, 5f)
        }

    /** Home — web `Home` ("Go to dashboard" button). A gabled roof over the house body with a doorway. */
    val Home: ImageVector =
        strokedGlyph("NotFoundHome") {
            moveTo(3f, 9f)
            lineTo(12f, 2f)
            lineTo(21f, 9f)
            lineTo(21f, 20f)
            lineTo(3f, 20f)
            close()
            moveTo(9f, 20f)
            lineTo(9f, 12f)
            lineTo(15f, 12f)
            lineTo(15f, 20f)
        }

    /** Search — web `Search` ("Open command palette" button). A lens with a trailing handle. */
    val Search: ImageVector =
        strokedGlyph("NotFoundSearch") {
            glyphCircle(11f, 11f, 7f)
            moveTo(21f, 21f)
            lineTo(16.65f, 16.65f)
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
