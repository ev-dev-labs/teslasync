// Locally-authored 24×24 stroked icon for the AddWidgetButton surface — the Android stand-in for the web
// `lucide-react` `Plus` glyph the FAB renders (`Icons.add`). Android ships no lucide equivalent without
// pulling the frozen `material-icons-extended` artifact, so — exactly as the sibling UserImpersonateButton
// and WeekSelector surfaces do for their lucide ports — the surface authors its own monochrome [ImageVector]
// (recolored at render time by the shared `Icon` content color). Authoring it here keeps the surface
// self-contained within its allowed-files directory rather than coupling it to another feature's glyph set.
//
// The path data reproduces lucide `plus` verbatim (a vertical and a horizontal stroke meeting at the
// center). The web bumps the stroke to 2.5 so the "+" stays legible against the saturated FAB fill; this
// glyph mirrors that weight.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AddWidgetButton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.addwidgetbutton

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single glyph the AddWidgetButton references, authored as a 24×24 round-capped stroked vector so it
 * inherits the Material 3 content color in every theme/state. It is decorative (the FAB carries an explicit
 * accessibility label), so it is rendered with a `null` content description at the call site.
 */
object AddWidgetButtonGlyphs {
    /** lucide `Plus` — a vertical + horizontal stroke crossing at the center, the universal "add" affordance. */
    val Plus: ImageVector =
        glyph("AddWidgetButtonPlus") {
            // Vertical stroke (lucide `M12 5v14`).
            moveTo(12f, 5f)
            lineTo(12f, 19f)
            // Horizontal stroke (lucide `M5 12h14`).
            moveTo(5f, 12f)
            lineTo(19f, 12f)
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
private const val GLYPH_STROKE = 2.5f
