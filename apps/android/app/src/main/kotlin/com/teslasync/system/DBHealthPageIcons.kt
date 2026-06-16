// Locally-authored stroked vector glyphs for the DBHealthPage surface — the native counterparts of the web lucide
// icons (`@/lib/icons`) the page uses: Database, ArrowUpDown, RefreshCw, CheckCircle, AlertTriangle. This mirrors
// the established sibling precedent (SystemStatusPage's glyph set): a glyph is authored locally as a 24×24 stroked
// vector and recolored at render via the Icon/StatCard `tint`, rather than editing the shared TeslaGlyphs catalog
// (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.dbhealth

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/StatCard `tint` at render. */
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
object DBHealthGlyphs {
    /** Cylinder stack — web `Database` (total-size / tables summary cards). */
    val Database: ImageVector =
        strokedGlyph("DBHealthDatabase") {
            moveTo(4f, 6f)
            curveTo(4f, 4.3f, 7.6f, 3f, 12f, 3f)
            curveTo(16.4f, 3f, 20f, 4.3f, 20f, 6f)
            lineTo(20f, 18f)
            curveTo(20f, 19.7f, 16.4f, 21f, 12f, 21f)
            curveTo(7.6f, 21f, 4f, 19.7f, 4f, 18f)
            close()
            moveTo(4f, 6f)
            curveTo(4f, 7.7f, 7.6f, 9f, 12f, 9f)
            curveTo(16.4f, 9f, 20f, 7.7f, 20f, 6f)
            moveTo(4f, 12f)
            curveTo(4f, 13.7f, 7.6f, 15f, 12f, 15f)
            curveTo(16.4f, 15f, 20f, 13.7f, 20f, 12f)
        }

    /** Two opposed vertical arrows — web `ArrowUpDown` (table sort control). */
    val ArrowUpDown: ImageVector =
        strokedGlyph("DBHealthArrowUpDown") {
            moveTo(7f, 4f)
            lineTo(7f, 20f)
            moveTo(7f, 4f)
            lineTo(4f, 7f)
            moveTo(7f, 4f)
            lineTo(10f, 7f)
            moveTo(17f, 20f)
            lineTo(17f, 4f)
            moveTo(17f, 20f)
            lineTo(14f, 17f)
            moveTo(17f, 20f)
            lineTo(20f, 17f)
        }

    /** Circular refresh arrows — web `RefreshCw` (auto-refresh / refresh action). */
    val RefreshCw: ImageVector =
        strokedGlyph("DBHealthRefreshCw") {
            moveTo(20f, 7f)
            lineTo(20f, 11f)
            lineTo(16f, 11f)
            moveTo(4f, 17f)
            lineTo(4f, 13f)
            lineTo(8f, 13f)
            moveTo(6f, 9f)
            curveTo(7.5f, 6f, 10.5f, 4.5f, 13.5f, 5.3f)
            curveTo(15.7f, 5.9f, 17.4f, 7.6f, 19f, 10f)
            moveTo(18f, 15f)
            curveTo(16.5f, 18f, 13.5f, 19.5f, 10.5f, 18.7f)
            curveTo(8.3f, 18.1f, 6.6f, 16.4f, 5f, 14f)
        }

    /** Circle with a check — web `CheckCircle` (migration-version summary card). */
    val CheckCircle: ImageVector =
        strokedGlyph("DBHealthCheckCircle") {
            moveTo(12f, 3f)
            curveTo(7f, 3f, 3f, 7f, 3f, 12f)
            curveTo(3f, 17f, 7f, 21f, 12f, 21f)
            curveTo(17f, 21f, 21f, 17f, 21f, 12f)
            curveTo(21f, 7f, 17f, 3f, 12f, 3f)
            close()
            moveTo(8.5f, 12f)
            lineTo(11f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** Warning triangle with a bang — web `AlertTriangle` (large-tables card + large-table row marker). */
    val AlertTriangle: ImageVector =
        strokedGlyph("DBHealthAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12f, 16.6f)
        }
}
