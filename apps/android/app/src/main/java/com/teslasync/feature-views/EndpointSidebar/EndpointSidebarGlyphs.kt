// Locally-authored 24×24 stroked icon for the EndpointSidebar surface — the Android stand-in for the web
// `lucide-react` `Search` glyph the sidebar uses as the search field's leading icon. Android ships no
// lucide equivalent, so the surface authors its own monochrome [ImageVector] (recolored at render time by
// `Icon`'s `tint`) — the same approach the sibling HttpStatusTool / ClientUtilitiesSection surfaces use.
// The collapsible group chevron reuses the shared `TeslaGlyphs.ChevronDown`, so only the magnifier is
// authored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EndpointSidebar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.endpointsidebar

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single icon this surface authors — the lucide `Search` mark (a circular lens with a diagonal
 * handle), drawn as a 24×24 round-capped stroked vector so it inherits the Material 3 content color in
 * every theme. Purely decorative (the field label carries the meaning), so it is rendered with a `null`
 * content description at its call site.
 */
object EndpointSidebarGlyphs {
    /** lucide `Search` — a circular lens (r≈8 at 11,11) with a short diagonal handle to the lower right. */
    val Search: ImageVector =
        glyph("Search") {
            circle(11f, 11f, 7f)
            moveTo(16f, 16f)
            lineTo(20f, 20f)
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
