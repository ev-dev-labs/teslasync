// Locally-authored stroked vector glyphs for the DiagnosticPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/system/pages/DiagnosticPage.tsx imports Activity, AlertTriangle,
// CheckCircle2, Download, PlayCircle, RefreshCw, ShieldAlert, XCircle). The shared icon catalog (TeslaGlyphs) ships
// none of these page glyphs and editing it is outside this surface's allowed files, so they are authored here as
// 24×24 monochrome stroked vectors and recolored at render via the `Icon` tint — exactly the approach the sibling A7
// page surfaces document (CommandsPageIcons, BatteryHealthPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.diagnostic

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
 * The glyph set this surface needs (the web DiagnosticPage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object DiagnosticGlyphs {
    /** Activity — web `Activity` (the no-report empty state). A single ECG pulse line. */
    val Activity: ImageVector =
        strokedGlyph("DiagnosticActivity") {
            moveTo(2f, 12f)
            lineTo(6f, 12f)
            lineTo(9f, 3f)
            lineTo(15f, 21f)
            lineTo(18f, 12f)
            lineTo(22f, 12f)
        }

    /** Alert triangle — web `AlertTriangle` (the degraded overall hero + the warn check). Triangle + exclamation. */
    val AlertTriangle: ImageVector =
        strokedGlyph("DiagnosticAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            glyphCircle(12f, 16.5f, 0.5f)
        }

    /** Check circle — web `CheckCircle2` (the healthy overall hero + the ok check). A ring with a check mark. */
    val CheckCircle: ImageVector =
        strokedGlyph("DiagnosticCheckCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(8f, 12f)
            lineTo(11f, 15f)
            lineTo(16f, 9f)
        }

    /** X circle — web `XCircle` (the failed check). A ring with an X. */
    val XCircle: ImageVector =
        strokedGlyph("DiagnosticXCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }

    /** Shield alert — web `ShieldAlert` (the down overall hero + the error banner). A shield with an exclamation. */
    val ShieldAlert: ImageVector =
        strokedGlyph("DiagnosticShieldAlert") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            lineTo(12f, 21f)
            lineTo(5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            glyphCircle(12f, 15.5f, 0.5f)
        }

    /** Download — web `Download` (the Download .txt action). Down arrow over a tray base. */
    val Download: ImageVector =
        strokedGlyph("DiagnosticDownload") {
            moveTo(12f, 3f)
            lineTo(12f, 15f)
            moveTo(8f, 11f)
            lineTo(12f, 15f)
            lineTo(16f, 11f)
            moveTo(5f, 19f)
            lineTo(19f, 19f)
        }

    /** Play circle — web `PlayCircle` (the Run-diagnostic button, no report yet). A ring with a play triangle. */
    val PlayCircle: ImageVector =
        strokedGlyph("DiagnosticPlayCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(10f, 8.5f)
            lineTo(16f, 12f)
            lineTo(10f, 15.5f)
            close()
        }

    /** Refresh — web `RefreshCw` (the Re-run button, once a report exists). Two arcs with arrowhead brackets. */
    val RefreshCw: ImageVector =
        strokedGlyph("DiagnosticRefreshCw") {
            moveTo(19f, 12f)
            arcTo(7f, 7f, 0f, false, false, 7.5f, 6.5f)
            moveTo(5f, 4f)
            lineTo(5f, 9f)
            lineTo(10f, 9f)
            moveTo(5f, 12f)
            arcTo(7f, 7f, 0f, false, false, 16.5f, 17.5f)
            moveTo(19f, 20f)
            lineTo(19f, 15f)
            lineTo(14f, 15f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the stroke color is replaced by the `Icon` tint at render. */
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
