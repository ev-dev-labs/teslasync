// Locally-authored stroked vector glyphs for the PowerFlowDashboardPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/battery/pages/PowerFlowDashboardPage.tsx imports Sun, Battery, Home,
// Zap, ShieldAlert, RefreshCw, ArrowDown, ArrowUp, Activity). This mirrors the established BatteryHealthPageIcons
// precedent: glyphs the shared catalogs already carry are re-exported from those catalogs (Battery / Zap=Bolt /
// ArrowDown / ArrowUp / RefreshCw=Refresh), and the remainder (Sun / Home / ShieldAlert / Activity) are authored
// locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather than editing the shared
// catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.powerflow

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.FeedbackGlyphs

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

/**
 * The glyph set this surface needs (web lucide icons). The five glyphs the shared catalogs already carry are re-exported
 * so the page reads every icon from one source; the other four are authored locally.
 */
object PowerFlowGlyphs {
    /** Battery — web `Battery` (battery power tile + backup-capable badge). Reused from the data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Lightning bolt — web `Zap` (grid power tile + grid status badge). Reused from the data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Down arrow — web `ArrowDown` (a forward power-flow leg). Reused from the data-display catalog. */
    val ArrowDown: ImageVector = DataDisplayGlyphs.ArrowDown

    /** Up arrow — web `ArrowUp` (a reverse power-flow leg). Reused from the data-display catalog. */
    val ArrowUp: ImageVector = DataDisplayGlyphs.ArrowUp

    /** Refresh cycle — web `RefreshCw` (the "Refresh from Tesla" button). Reused from the feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Sun — web `Sun` (solar production). A center disc plus eight rays. */
    val Sun: ImageVector =
        strokedGlyph("PowerFlowSun") {
            moveTo(16f, 12f)
            arcTo(4f, 4f, 0f, true, true, 8f, 12f)
            arcTo(4f, 4f, 0f, true, true, 16f, 12f)
            close()
            moveTo(12f, 2f)
            lineTo(12f, 4f)
            moveTo(12f, 20f)
            lineTo(12f, 22f)
            moveTo(2f, 12f)
            lineTo(4f, 12f)
            moveTo(20f, 12f)
            lineTo(22f, 12f)
            moveTo(18.4f, 5.6f)
            lineTo(17f, 7f)
            moveTo(5.6f, 5.6f)
            lineTo(7f, 7f)
            moveTo(18.4f, 18.4f)
            lineTo(17f, 17f)
            moveTo(5.6f, 18.4f)
            lineTo(7f, 17f)
        }

    /** House — web `Home` (home consumption). A roof + walls with a door. */
    val Home: ImageVector =
        strokedGlyph("PowerFlowHome") {
            moveTo(3f, 10.5f)
            lineTo(12f, 3f)
            lineTo(21f, 10.5f)
            lineTo(21f, 20f)
            lineTo(3f, 20f)
            close()
            moveTo(9f, 20f)
            lineTo(9f, 14f)
            lineTo(15f, 14f)
            lineTo(15f, 20f)
        }

    /** Shield with alert — web `ShieldAlert` (storm-mode badge). A shield outline plus a centered exclamation. */
    val ShieldAlert: ImageVector =
        strokedGlyph("PowerFlowShieldAlert") {
            moveTo(12f, 3f)
            lineTo(20f, 6f)
            lineTo(20f, 11f)
            curveTo(20f, 16f, 16.5f, 19.5f, 12f, 21f)
            curveTo(7.5f, 19.5f, 4f, 16f, 4f, 11f)
            lineTo(4f, 6f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            moveTo(12f, 16f)
            lineTo(12f, 16.2f)
        }

    /** Activity pulse line — web `Activity` (last-update badge + power-flow empty state). */
    val Activity: ImageVector =
        strokedGlyph("PowerFlowActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }
}
