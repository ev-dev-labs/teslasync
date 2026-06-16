// Locally-authored stroked vector glyph for the InboxPage surface — the native counterpart of the single web
// lucide icon the page renders (web/src/features/notifications/pages/InboxPage.tsx imports `Archive`, the leading
// icon of the "View archived" action). The shared icon catalog (TeslaGlyphs) ships no Archive glyph and editing
// it is outside this surface's allowed files, so it is authored here as a 24×24 monochrome stroked vector and
// recolored at render via the `Icon`/`Button` tint — exactly the approach the sibling A7 ports
// (GlancePageIcons, BatteryHealthPageIcons) and the NotificationGroupRow feature view document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.inbox

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
 * The glyph set this surface needs (the web InboxPage lucide icon). A monochrome 24×24 stroked vector recolored
 * by the `Icon`/`Button` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object InboxPageGlyphs {
    /** Lidded box — web lucide `Archive`, the leading icon of the "View archived" header action. */
    val Archive: ImageVector =
        strokedGlyph("InboxArchive") {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 8f)
            lineTo(3f, 8f)
            close()
            moveTo(4f, 8f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 8f)
            moveTo(10f, 12f)
            lineTo(14f, 12f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the stroke color is replaced by the tint at render. */
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
