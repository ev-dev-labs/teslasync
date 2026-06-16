// Locally-authored stroked vector glyphs for the StateMachineDebuggerPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/system/pages/StateMachineDebuggerPage.tsx imports RefreshCw,
// ChevronDown, ChevronRight, Activity, Zap, AlertTriangle; the page also draws a HelpTooltip info affordance and a
// share/permalink action). The shared icon catalog (TeslaGlyphs) ships none of these page glyphs and editing it is
// outside this surface's allowed files, so they are authored here as 24×24 monochrome stroked vectors and recolored at
// render via the `Icon` tint — exactly the approach the sibling A7 page surfaces document (CommandsPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.statemachinedebugger

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
 * The glyph set this surface needs (the web StateMachineDebuggerPage lucide icons). Each is a monochrome 24×24 stroked
 * vector recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object FsmGlyphs {
    /** Refresh — web `RefreshCw` (the "Live 10s" auto-refresh indicator). Two opposed arcs with corner arrowheads. */
    val Refresh: ImageVector =
        strokedGlyph("FsmRefresh") {
            moveTo(20f, 12f)
            arcTo(8f, 8f, 0f, false, false, 6.5f, 6.2f)
            moveTo(4f, 4f)
            lineTo(4f, 9f)
            lineTo(9f, 9f)
            moveTo(4f, 12f)
            arcTo(8f, 8f, 0f, false, false, 17.5f, 17.8f)
            moveTo(20f, 20f)
            lineTo(20f, 15f)
            lineTo(15f, 15f)
        }

    /** Activity — web `Activity` (the Transitions / Total-Transitions summary cards). A single ECG pulse line. */
    val Activity: ImageVector =
        strokedGlyph("FsmActivity") {
            moveTo(2f, 12f)
            lineTo(6f, 12f)
            lineTo(9f, 3f)
            lineTo(15f, 21f)
            lineTo(18f, 12f)
            lineTo(22f, 12f)
        }

    /** Zap — web `Zap` (the Current-State summary card). A lightning bolt polygon. */
    val Zap: ImageVector =
        strokedGlyph("FsmZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** Alert triangle — web `AlertTriangle` (the Flap-Warnings summary card). Triangle + exclamation. */
    val AlertTriangle: ImageVector =
        strokedGlyph("FsmAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            glyphCircle(12f, 16.5f, 0.5f)
        }

    /** Chevron down — web `ChevronDown` (an expanded transition row's detail toggle). */
    val ChevronDown: ImageVector =
        strokedGlyph("FsmChevronDown") {
            moveTo(6f, 9f)
            lineTo(12f, 15f)
            lineTo(18f, 9f)
        }

    /** Chevron right — web `ChevronRight` (a collapsed transition row's detail toggle). */
    val ChevronRight: ImageVector =
        strokedGlyph("FsmChevronRight") {
            moveTo(9f, 6f)
            lineTo(15f, 12f)
            lineTo(9f, 18f)
        }

    /** Info — web `HelpTooltip` (the FSM-type + live-state help affordances). A ringed lower-case "i". */
    val Info: ImageVector =
        strokedGlyph("FsmInfo") {
            glyphCircle(12f, 12f, 9f)
            moveTo(12f, 11f)
            lineTo(12f, 16f)
            glyphCircle(12f, 8f, 0.6f)
        }

    /** Share — web `CopyButton` (the "Share permalink" header action). Three nodes joined by two links. */
    val Share: ImageVector =
        strokedGlyph("FsmShare") {
            glyphCircle(18f, 5f, 2f)
            glyphCircle(6f, 12f, 2f)
            glyphCircle(18f, 19f, 2f)
            moveTo(8f, 11f)
            lineTo(16f, 6.5f)
            moveTo(8f, 13f)
            lineTo(16f, 17.5f)
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
