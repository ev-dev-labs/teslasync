// Locally-authored stroked vector glyphs for the CommandHistoryPage surface — the native counterparts of the
// web lucide icons (`lucide-react`) the page uses (History, CheckCircle, XCircle, Terminal, Clock, TrendingUp,
// Award, Search, Gamepad2). This mirrors the established admin-surface precedent (ApiLogsPage's glyph set): a
// glyph is authored locally as a 24×24 stroked vector and recolored at render via the Icon/StatCard/Timeline
// `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.commandhistory

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/StatCard/Timeline `tint` at render. */
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

/** The local glyph set this surface needs (web lucide icons). */
object CommandHistoryGlyphs {
    /** Clock face with a counter-clockwise arrow — web `History` (timeline header). */
    val History: ImageVector =
        strokedGlyph("CommandHistoryHistory") {
            moveTo(4f, 11f)
            curveTo(4.4f, 7f, 7.8f, 4f, 12f, 4f)
            curveTo(16.4f, 4f, 20f, 7.6f, 20f, 12f)
            curveTo(20f, 16.4f, 16.4f, 20f, 12f, 20f)
            curveTo(9.1f, 20f, 6.6f, 18.5f, 5.2f, 16.2f)
            moveTo(4f, 11f)
            lineTo(2.5f, 9.5f)
            moveTo(4f, 11f)
            lineTo(6f, 9.5f)
            moveTo(12f, 8f)
            lineTo(12f, 12f)
            lineTo(15f, 14f)
        }

    /** Circle with a check — web `CheckCircle` (success tab + successful command rows). */
    val CheckCircle: ImageVector =
        strokedGlyph("CommandHistoryCheckCircle") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(8.5f, 12f)
            lineTo(11f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** Circle with an X — web `XCircle` (failed tab + failed command rows). */
    val XCircle: ImageVector =
        strokedGlyph("CommandHistoryXCircle") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(9.5f, 9.5f)
            lineTo(14.5f, 14.5f)
            moveTo(14.5f, 9.5f)
            lineTo(9.5f, 14.5f)
        }

    /** Terminal window with a prompt chevron — web `Terminal` (Commands-24h stat + the "All" tab). */
    val Terminal: ImageVector =
        strokedGlyph("CommandHistoryTerminal") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(20f, 19f)
            lineTo(4f, 19f)
            close()
            moveTo(7.5f, 9.5f)
            lineTo(10.5f, 12f)
            lineTo(7.5f, 14.5f)
            moveTo(12.5f, 15f)
            lineTo(16f, 15f)
        }

    /** Clock — web `Clock` (Last-Sent stat). */
    val Clock: ImageVector =
        strokedGlyph("CommandHistoryClock") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15f, 14f)
        }

    /** Up-trending line with an arrowhead — web `TrendingUp` (Success-Rate stat). */
    val TrendingUp: ImageVector =
        strokedGlyph("CommandHistoryTrendingUp") {
            moveTo(4f, 16f)
            lineTo(10f, 10f)
            lineTo(13f, 13f)
            lineTo(20f, 6f)
            moveTo(15f, 6f)
            lineTo(20f, 6f)
            lineTo(20f, 11f)
        }

    /** Medal with a ribbon — web `Award` (Most-Used stat). */
    val Award: ImageVector =
        strokedGlyph("CommandHistoryAward") {
            moveTo(12f, 4f)
            curveTo(9.2f, 4f, 7f, 6.2f, 7f, 9f)
            curveTo(7f, 11.8f, 9.2f, 14f, 12f, 14f)
            curveTo(14.8f, 14f, 17f, 11.8f, 17f, 9f)
            curveTo(17f, 6.2f, 14.8f, 4f, 12f, 4f)
            close()
            moveTo(9.5f, 13.5f)
            lineTo(8f, 20f)
            lineTo(12f, 17.5f)
            lineTo(16f, 20f)
            lineTo(14.5f, 13.5f)
        }

    /** Magnifying glass — web `Search` (command search field). */
    val Search: ImageVector =
        strokedGlyph("CommandHistorySearch") {
            moveTo(11f, 4f)
            curveTo(7.1f, 4f, 4f, 7.1f, 4f, 11f)
            curveTo(4f, 14.9f, 7.1f, 18f, 11f, 18f)
            curveTo(14.9f, 18f, 18f, 14.9f, 18f, 11f)
            curveTo(18f, 7.1f, 14.9f, 4f, 11f, 4f)
            close()
            moveTo(16f, 16f)
            lineTo(20f, 20f)
        }

    /** Game controller — web `Gamepad2` (back-to-Commands action). */
    val Gamepad2: ImageVector =
        strokedGlyph("CommandHistoryGamepad2") {
            moveTo(8f, 8f)
            lineTo(16f, 8f)
            curveTo(18.8f, 8f, 21f, 10.2f, 21f, 13f)
            curveTo(21f, 15.2f, 19.2f, 17f, 17f, 17f)
            curveTo(15.8f, 17f, 14.8f, 16.4f, 14.2f, 15.5f)
            lineTo(9.8f, 15.5f)
            curveTo(9.2f, 16.4f, 8.2f, 17f, 7f, 17f)
            curveTo(4.8f, 17f, 3f, 15.2f, 3f, 13f)
            curveTo(3f, 10.2f, 5.2f, 8f, 8f, 8f)
            close()
            moveTo(6f, 11.5f)
            lineTo(6f, 14f)
            moveTo(4.8f, 12.7f)
            lineTo(7.2f, 12.7f)
            moveTo(15f, 12f)
            lineTo(15.1f, 12f)
            moveTo(17.5f, 13.5f)
            lineTo(17.6f, 13.5f)
        }
}
