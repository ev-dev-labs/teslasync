// Locally-authored 24×24 stroked icon for the HttpStatusTool surface — the Android stand-in for the web
// `lucide-react` `Network` glyph the tool uses for both its ToolCard icon and the search field's leading
// icon. Android ships no lucide equivalent, so the surface authors its own monochrome [ImageVector]
// (recolored at render time by `Icon`'s `tint`) — the same approach the sibling ClientUtilitiesSection /
// widget surfaces use.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HttpStatusTool) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.httpstatus

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single icon this surface references — the lucide `Network` mark (a parent node linked to two child
 * nodes), authored as a 24×24 round-capped stroked vector so it inherits the Material 3 content color in
 * every theme. Purely decorative (the title + field label carry the meaning), so it is rendered with a
 * `null` content description at each call site.
 */
object HttpStatusToolGlyphs {
    /** lucide `Network` — a parent node linked to two child nodes. */
    val Network: ImageVector =
        glyph("Network") {
            circle(12f, 5f, 2f)
            circle(6f, 19f, 2f)
            circle(18f, 19f, 2f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            moveTo(12f, 12f)
            lineTo(6f, 17f)
            moveTo(12f, 12f)
            lineTo(18f, 17f)
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

/** Emits a full circle of radius [r] centered at ([cx], [cy]) as two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
