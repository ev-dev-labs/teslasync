// Locally-authored stroked vector glyphs for the HelpPage surface — the native counterparts of the web lucide icons
// the page renders (web/src/features/system/pages/HelpPage.tsx imports BookOpen, Rocket, ServerCog, Search,
// MessagesSquare, ArrowRight). The shared icon catalog (TeslaGlyphs) ships none of these page glyphs and editing it is
// outside this surface's allowed files, so they are authored here as 24×24 monochrome stroked vectors and recolored
// at render via the `Icon` tint — exactly the approach the sibling CommandsPage surface documents (CommandsPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.help

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
 * The glyph set this surface needs (the web HelpPage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object HelpGlyphs {
    /** Open book — web `BookOpen` (the Documentation link). A center spine with a splayed page on each side. */
    val BookOpen: ImageVector =
        strokedGlyph("HelpBookOpen") {
            moveTo(12f, 7f)
            lineTo(12f, 20f)
            moveTo(12f, 7f)
            lineTo(4f, 5f)
            lineTo(4f, 17f)
            lineTo(12f, 19f)
            moveTo(12f, 7f)
            lineTo(20f, 5f)
            lineTo(20f, 17f)
            lineTo(12f, 19f)
        }

    /** Rocket — web `Rocket` (the Onboarding link). A capsule body with a porthole, two fins, and a V exhaust. */
    val Rocket: ImageVector =
        strokedGlyph("HelpRocket") {
            moveTo(9.5f, 12.5f)
            lineTo(9.5f, 9f)
            arcTo(2.5f, 2.5f, 0f, false, true, 14.5f, 9f)
            lineTo(14.5f, 12.5f)
            lineTo(12f, 16f)
            close()
            glyphCircle(12f, 9f, 1.3f)
            moveTo(9.5f, 12f)
            lineTo(6.5f, 14f)
            lineTo(9.5f, 15f)
            moveTo(14.5f, 12f)
            lineTo(17.5f, 14f)
            lineTo(14.5f, 15f)
        }

    /** Server with a cog — web `ServerCog` (the System status link). Two rack units plus a small gear. */
    val ServerCog: ImageVector =
        strokedGlyph("HelpServerCog") {
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 10f)
            lineTo(4f, 10f)
            close()
            glyphCircle(7f, 7f, 0.7f)
            moveTo(15f, 7f)
            lineTo(17f, 7f)
            moveTo(4f, 14f)
            lineTo(12f, 14f)
            lineTo(12f, 20f)
            lineTo(4f, 20f)
            close()
            glyphCircle(7f, 17f, 0.7f)
            glyphCircle(17f, 17f, 2f)
            moveTo(17f, 14.5f)
            lineTo(17f, 15.2f)
            moveTo(17f, 18.8f)
            lineTo(17f, 19.5f)
            moveTo(14.5f, 17f)
            lineTo(15.2f, 17f)
            moveTo(18.8f, 17f)
            lineTo(19.5f, 17f)
        }

    /** Magnifier — web `Search` (the Search link). A ring with a diagonal handle. */
    val Search: ImageVector =
        strokedGlyph("HelpSearch") {
            glyphCircle(11f, 11f, 7f)
            moveTo(16f, 16f)
            lineTo(21f, 21f)
        }

    /** Two chat bubbles — web `MessagesSquare` (the Chatbot link). Overlapping speech squares with tails. */
    val MessagesSquare: ImageVector =
        strokedGlyph("HelpMessagesSquare") {
            moveTo(3f, 4f)
            lineTo(13f, 4f)
            lineTo(13f, 11f)
            lineTo(8f, 11f)
            lineTo(5f, 14f)
            lineTo(5f, 11f)
            lineTo(3f, 11f)
            close()
            moveTo(11f, 8f)
            lineTo(21f, 8f)
            lineTo(21f, 15f)
            lineTo(19f, 15f)
            lineTo(16f, 18f)
            lineTo(16f, 15f)
            lineTo(11f, 15f)
            close()
        }

    /** Right arrow — web `ArrowRight` (each card's trailing affordance). A shaft with an arrowhead. */
    val ArrowRight: ImageVector =
        strokedGlyph("HelpArrowRight") {
            moveTo(5f, 12f)
            lineTo(19f, 12f)
            moveTo(13f, 6f)
            lineTo(19f, 12f)
            lineTo(13f, 18f)
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
