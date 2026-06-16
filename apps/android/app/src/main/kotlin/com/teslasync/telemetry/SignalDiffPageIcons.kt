// Locally-authored stroked vector glyphs for the SignalDiffPage telemetry surface — the native counterparts of the
// web lucide icons the page renders: `GitCompare` (the no-changes empty state), `PinOff` (the bulk "Unpin selected"
// action), and `Bell` (the bulk "Add as alert rule" action). The bulk "Pin selected" + "Copy CSV" actions reuse the
// shared TeslaGlyphs catalog (Pin / Copy). This mirrors the established admin-page precedent (IngestXRayPageIcons):
// each glyph is authored locally as a 24×24 stroked vector and recolored at render via the Icon `tint`, rather than
// editing the shared TeslaGlyphs catalog (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signaldiff

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

/** The local glyph set this surface needs (web lucide icons). */
object SignalDiffGlyphs {
    /** Two opposing arrows — web `GitCompare` (the "no signals changed" empty state). */
    val GitCompare: ImageVector =
        strokedGlyph("SignalDiffGitCompare") {
            moveTo(4f, 8f)
            lineTo(20f, 8f)
            moveTo(16f, 4f)
            lineTo(20f, 8f)
            lineTo(16f, 12f)
            moveTo(20f, 16f)
            lineTo(4f, 16f)
            moveTo(8f, 12f)
            lineTo(4f, 16f)
            lineTo(8f, 20f)
        }

    /** A pin with a cancel slash — web `PinOff` (the bulk "Unpin selected" action). */
    val PinOff: ImageVector =
        strokedGlyph("SignalDiffPinOff") {
            moveTo(12f, 14f)
            lineTo(12f, 21f)
            moveTo(8f, 4f)
            lineTo(16f, 4f)
            moveTo(9f, 4f)
            lineTo(9.5f, 10f)
            lineTo(7f, 13f)
            lineTo(17f, 13f)
            lineTo(14.5f, 10f)
            lineTo(15f, 4f)
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    /** A notification bell — web `Bell` (the bulk "Add as alert rule" action). */
    val Bell: ImageVector =
        strokedGlyph("SignalDiffBell") {
            moveTo(6f, 16f)
            lineTo(18f, 16f)
            moveTo(8f, 16f)
            lineTo(8f, 11f)
            curveTo(8f, 8f, 12f, 8f, 12f, 8f)
            curveTo(12f, 8f, 16f, 8f, 16f, 11f)
            lineTo(16f, 16f)
            moveTo(12f, 8f)
            lineTo(12f, 6f)
            moveTo(10.5f, 19f)
            lineTo(13.5f, 19f)
        }
}
