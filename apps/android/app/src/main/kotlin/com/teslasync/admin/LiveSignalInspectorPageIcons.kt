// Locally-authored stroked vector glyphs for the LiveSignalInspectorPage surface — the native counterparts of
// the web lucide icons (`@/lib/icons`) the page uses: `Radio` (the no-vehicle empty state), `Activity` (the
// live-snapshot panel header), and `Search` (the signal-name filter field). This mirrors the established
// admin-surface precedent (ApiLogsPage's glyph set): a glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope
// here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.livesignals

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
object LiveSignalGlyphs {
    /** Concentric broadcast arcs around a center dot — web `Radio` (no-vehicle empty state). */
    val Radio: ImageVector =
        strokedGlyph("LiveSignalsRadio") {
            moveTo(12f, 11f)
            curveTo(11.4f, 11f, 11f, 11.4f, 11f, 12f)
            curveTo(11f, 12.6f, 11.4f, 13f, 12f, 13f)
            curveTo(12.6f, 13f, 13f, 12.6f, 13f, 12f)
            curveTo(13f, 11.4f, 12.6f, 11f, 12f, 11f)
            close()
            moveTo(8.5f, 8.5f)
            curveTo(6.6f, 10.4f, 6.6f, 13.6f, 8.5f, 15.5f)
            moveTo(15.5f, 8.5f)
            curveTo(17.4f, 10.4f, 17.4f, 13.6f, 15.5f, 15.5f)
            moveTo(6f, 6f)
            curveTo(2.7f, 9.3f, 2.7f, 14.7f, 6f, 18f)
            moveTo(18f, 6f)
            curveTo(21.3f, 9.3f, 21.3f, 14.7f, 18f, 18f)
        }

    /** ECG-style pulse line — web `Activity` (live-snapshot panel header). */
    val Activity: ImageVector =
        strokedGlyph("LiveSignalsActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Magnifying glass — web `Search` (signal-name filter field). */
    val Search: ImageVector =
        strokedGlyph("LiveSignalsSearch") {
            moveTo(11f, 4f)
            curveTo(7.1f, 4f, 4f, 7.1f, 4f, 11f)
            curveTo(4f, 14.9f, 7.1f, 18f, 11f, 18f)
            curveTo(14.9f, 18f, 18f, 14.9f, 18f, 11f)
            curveTo(18f, 7.1f, 14.9f, 4f, 11f, 4f)
            close()
            moveTo(16f, 16f)
            lineTo(20f, 20f)
        }
}
