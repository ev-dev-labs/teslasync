// Locally-authored stroked vector glyphs for the SignalExplorerPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/telemetry/pages/SignalExplorerPage.tsx): `Activity` (the
// no-vehicle empty state), `Database` (the Explore action + the "pick signals" empty state), and `Radio` (the
// Live / Stop-live toggle). This mirrors the established page-icon precedent (IngestXRayPageIcons / ApiLogsPageIcons):
// each glyph is authored locally as a 24×24 stroked vector and recolored at render via the Icon `tint`, rather than
// editing the shared TeslaGlyphs catalog (out of scope here). The web `AlertCircle` is intentionally omitted — the
// shared AlertBanner supplies its own danger glyph for the error state.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalexplorer

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
object SignalExplorerGlyphs {
    /** ECG-style pulse line — web `Activity` (the no-vehicle empty state icon). */
    val Activity: ImageVector =
        strokedGlyph("SignalExplorerActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Cylinder stack — web `Database` (the Explore action + the "pick signals" empty state icon). */
    val Database: ImageVector =
        strokedGlyph("SignalExplorerDatabase") {
            // Top ellipse (rim).
            moveTo(5f, 5f)
            curveTo(5f, 3.3f, 8.1f, 2f, 12f, 2f)
            curveTo(15.9f, 2f, 19f, 3.3f, 19f, 5f)
            curveTo(19f, 6.7f, 15.9f, 8f, 12f, 8f)
            curveTo(8.1f, 8f, 5f, 6.7f, 5f, 5f)
            close()
            // Left + right walls.
            moveTo(5f, 5f)
            lineTo(5f, 19f)
            moveTo(19f, 5f)
            lineTo(19f, 19f)
            // Middle band.
            moveTo(5f, 12f)
            curveTo(5f, 13.7f, 8.1f, 15f, 12f, 15f)
            curveTo(15.9f, 15f, 19f, 13.7f, 19f, 12f)
            // Bottom rim.
            moveTo(5f, 19f)
            curveTo(5f, 20.7f, 8.1f, 22f, 12f, 22f)
            curveTo(15.9f, 22f, 19f, 20.7f, 19f, 19f)
        }

    /** Broadcast waves around a hub — web `Radio` (the Live / Stop-live toggle icon). */
    val Radio: ImageVector =
        strokedGlyph("SignalExplorerRadio") {
            // Center hub.
            moveTo(10.5f, 12f)
            curveTo(10.5f, 11.17f, 11.17f, 10.5f, 12f, 10.5f)
            curveTo(12.83f, 10.5f, 13.5f, 11.17f, 13.5f, 12f)
            curveTo(13.5f, 12.83f, 12.83f, 13.5f, 12f, 13.5f)
            curveTo(11.17f, 13.5f, 10.5f, 12.83f, 10.5f, 12f)
            close()
            // Inner waves.
            moveTo(8.5f, 15.5f)
            curveTo(6.5f, 13.5f, 6.5f, 10.5f, 8.5f, 8.5f)
            moveTo(15.5f, 8.5f)
            curveTo(17.5f, 10.5f, 17.5f, 13.5f, 15.5f, 15.5f)
            // Outer waves.
            moveTo(6f, 18f)
            curveTo(2.7f, 14.7f, 2.7f, 9.3f, 6f, 6f)
            moveTo(18f, 6f)
            curveTo(21.3f, 9.3f, 21.3f, 14.7f, 18f, 18f)
        }
}
