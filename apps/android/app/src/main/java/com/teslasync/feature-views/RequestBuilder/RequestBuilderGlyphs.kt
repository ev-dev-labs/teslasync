// Locally-authored 24×24 stroked icon for the RequestBuilder surface — the Android stand-in for the web
// `lucide-react` `Send` glyph the builder renders inside its primary "Send" button. Android ships no lucide
// equivalent, so the surface authors its own monochrome [ImageVector] (recolored at render time by the
// button's content color) — the same approach the sibling EndpointSidebar / HttpStatusTool surfaces use for
// their lucide marks. The destructive-confirmation banner reuses the shared `TeslaGlyphs.Warning`, so only
// the paper-plane is authored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RequestBuilder) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.requestbuilder

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single icon this surface authors — the lucide `Send` mark (a paper plane): the filled outline of the
 * dart plus the fold line from its nose to the inner notch, drawn as a 24×24 round-capped/joined stroked
 * vector so it inherits the Material 3 content color in every theme. Purely decorative (the button label
 * "Send" carries the meaning), so it is rendered with a `null` content description at its call site.
 */
object RequestBuilderGlyphs {
    /** lucide `Send` — the dart outline (22,2 → 15,22 → 11,13 → 2,9 → close) plus the nose-to-notch fold. */
    val Send: ImageVector =
        glyph("Send") {
            moveTo(22f, 2f)
            lineTo(15f, 22f)
            lineTo(11f, 13f)
            lineTo(2f, 9f)
            close()
            moveTo(22f, 2f)
            lineTo(11f, 13f)
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
