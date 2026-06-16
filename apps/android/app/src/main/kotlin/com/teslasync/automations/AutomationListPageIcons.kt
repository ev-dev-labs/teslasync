// Locally-authored stroked vector glyphs for the AutomationListPage surface — the native counterparts of the
// web lucide icons the page's bulk actions render (web/src/features/automations/pages/AutomationListPage.tsx
// uses `Icons.play`, `Icons.pause`, `Icons.delete` on the enable / disable / delete bulk buttons). This mirrors
// the established admin-page precedent (SlowQueriesPageIcons / SchemaDriftPageIcons): each glyph is authored
// locally as a 24×24 stroked vector and recolored at render via the Icon `tint`, rather than editing the
// shared TeslaGlyphs catalog (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations.list

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon `tint` at render. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** The local glyph set this surface needs (web lucide bulk-action icons). */
object AutomationListGlyphs {
    /** Right-pointing play triangle — web `Icons.play` (the bulk Enable action). */
    val Play: ImageVector =
        strokedGlyph("AutomationListPlay") {
            moveTo(7f, 5f)
            lineTo(19f, 12f)
            lineTo(7f, 19f)
            close()
        }

    /** Two vertical bars — web `Icons.pause` (the bulk Disable action). */
    val Pause: ImageVector =
        strokedGlyph("AutomationListPause") {
            moveTo(9f, 5f)
            lineTo(9f, 19f)
            moveTo(15f, 5f)
            lineTo(15f, 19f)
        }

    /** Trash can with lid + handle + two inner cut lines — web `Icons.delete` (the bulk Delete action). */
    val Trash: ImageVector =
        strokedGlyph("AutomationListTrash") {
            // Lid bar across the top.
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            // Handle on the lid.
            moveTo(9f, 6f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 6f)
            // Can body.
            moveTo(6f, 6f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 6f)
            // Two inner vertical cut lines.
            moveTo(10f, 10f)
            lineTo(10f, 16f)
            moveTo(14f, 10f)
            lineTo(14f, 16f)
        }
}
