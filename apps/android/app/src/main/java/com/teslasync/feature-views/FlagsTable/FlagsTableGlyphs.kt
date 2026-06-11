// Locally-authored 24×24 stroked icon for the FlagsTable surface — the Android stand-in for the web
// `lucide-react` `Trash2` glyph on the per-row Delete button. Android ships no lucide equivalent and
// the project deliberately avoids the frozen `material-icons-extended` artifact, so the surface
// authors its own monochrome [ImageVector] (recolored at render time by the button's content color) —
// the same approach the sibling HttpStatusTool / feedback-layer glyph sets use. The Edit action reuses
// the shared `ui.TeslaGlyphs.Edit` pencil, so only the trash mark is defined here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FlagsTable) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.flagstable

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single icon this surface references — the lucide `Trash2` mark (lid, top handle, tapered can,
 * and two vertical ribs), authored as a 24×24 round-capped stroked vector so it inherits the Material 3
 * content color in every theme. Purely decorative (the button's "Delete" label carries the meaning),
 * so it is rendered with a `null` content description at the call site.
 */
object FlagsTableGlyphs {
    val Trash2: ImageVector =
        glyph("Trash2") {
            // Lid.
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            // Top handle.
            moveTo(9f, 7f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 7f)
            // Tapered can body.
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 7f)
            // Vertical ribs.
            moveTo(10f, 11f)
            lineTo(10f, 17f)
            moveTo(14f, 11f)
            lineTo(14f, 17f)
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
