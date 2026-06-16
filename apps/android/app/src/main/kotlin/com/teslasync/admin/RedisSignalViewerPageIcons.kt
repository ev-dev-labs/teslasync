// Locally-authored stroked vector glyph for the RedisSignalViewerPage surface — the native counterpart of the one
// web lucide icon the page needs that is absent from every shared catalog (`Database`, shown on the Total-Signals
// stat card + the select-a-vehicle empty state). This mirrors the established admin-page precedent
// (IngestXRayPageIcons / ApiLogsPageIcons): a glyph is authored locally as a 24×24 stroked vector and recolored
// at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here). The
// page's other three web icons already exist in the shared catalogs and are reused by the composable
// (`FormsGlyphs.Search`, `FeedbackGlyphs.Refresh`, `MapsGlyphs.Trash`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.redissignals

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

/** The local glyph set this surface needs (web lucide icons absent from the shared catalogs). */
object RedisSignalViewerGlyphs {
    /** A storage cylinder — web lucide `Database` (the Total-Signals stat card + the select-a-vehicle prompt). */
    val Database: ImageVector =
        strokedGlyph("RedisSignalViewerDatabase") {
            moveTo(4f, 6f)
            curveTo(4f, 4.3f, 7.6f, 3f, 12f, 3f)
            curveTo(16.4f, 3f, 20f, 4.3f, 20f, 6f)
            curveTo(20f, 7.7f, 16.4f, 9f, 12f, 9f)
            curveTo(7.6f, 9f, 4f, 7.7f, 4f, 6f)
            close()
            moveTo(4f, 6f)
            lineTo(4f, 18f)
            curveTo(4f, 19.7f, 7.6f, 21f, 12f, 21f)
            curveTo(16.4f, 21f, 20f, 19.7f, 20f, 18f)
            lineTo(20f, 6f)
            moveTo(4f, 12f)
            curveTo(4f, 13.7f, 7.6f, 15f, 12f, 15f)
            curveTo(16.4f, 15f, 20f, 13.7f, 20f, 12f)
        }
}
