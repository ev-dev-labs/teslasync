// Locally-authored stroked vector glyphs for the SlowQueriesPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/admin/pages/SlowQueriesPage.tsx imports `Timer`; the page
// also draws a circled-bang error affordance). This mirrors the established admin-page precedent
// (SchemaDriftPageIcons / ApiLogsPageIcons): each glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope
// here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.slowqueries

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
object SlowQueriesGlyphs {
    /** Stopwatch with a top knob bar and a hand — web `Timer` (the no-slow-queries empty state). */
    val Timer: ImageVector =
        strokedGlyph("SlowQueriesTimer") {
            // Top knob bar.
            moveTo(10f, 2.5f)
            lineTo(14f, 2.5f)
            // Dial body — a circle centered at (12, 14) with radius 8.
            moveTo(12f, 6f)
            curveTo(7.6f, 6f, 4f, 9.6f, 4f, 14f)
            curveTo(4f, 18.4f, 7.6f, 22f, 12f, 22f)
            curveTo(16.4f, 22f, 20f, 18.4f, 20f, 14f)
            curveTo(20f, 9.6f, 16.4f, 6f, 12f, 6f)
            close()
            // Hand pointing up and to the right.
            moveTo(12f, 14f)
            lineTo(15f, 11f)
        }

    /** Circled bang — the load-failed error affordance (web page-tier error). */
    val AlertCircle: ImageVector =
        strokedGlyph("SlowQueriesAlertCircle") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            moveTo(12f, 15.5f)
            lineTo(12f, 15.6f)
        }
}
