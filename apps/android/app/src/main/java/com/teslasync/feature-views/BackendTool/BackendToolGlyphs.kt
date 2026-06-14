// Locally-authored 24×24 icon for the BackendTool surface — the Android stand-in for the web
// `lucide-react` `Play` glyph the component renders as the Run button's leading icon
// (web/src/features/admin/components/devtools/BackendTool.tsx: `icon={<Play className="h-3.5 w-3.5" />}`).
// Android ships no lucide equivalent without the frozen `material-icons-extended` artifact, so the
// surface authors its own monochrome [ImageVector] (recolored at render time by the host `Icon`'s tint) —
// the same approach the sibling HttpStatusTool / FleetApiSection surfaces use.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackendTool) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendtool

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single icon this surface references — the lucide `Play` mark, authored as a 24×24 filled triangle
 * pointing right so it inherits the Material 3 content color in every theme. Purely decorative (the
 * button's "Run" label carries the meaning), so it is rendered with a `null` content description at the
 * call site.
 */
object BackendToolGlyphs {
    private val GLYPH_SIZE = 24.dp
    private const val GLYPH_VIEWPORT = 24f

    /** lucide `Play` — a right-pointing filled triangle. */
    val Play: ImageVector =
        ImageVector
            .Builder(
                name = "Play",
                defaultWidth = GLYPH_SIZE,
                defaultHeight = GLYPH_SIZE,
                viewportWidth = GLYPH_VIEWPORT,
                viewportHeight = GLYPH_VIEWPORT,
            ).apply {
                path(fill = SolidColor(Color.Black)) {
                    moveTo(8f, 5f)
                    lineTo(8f, 19f)
                    lineTo(19f, 12f)
                    close()
                }
            }.build()
}
