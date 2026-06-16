// Locally-authored stroked vector glyphs for the TirePressurePage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/vehicle-systems/pages/TirePressurePage.tsx imports Gauge, AlertTriangle,
// TrendingDown, Activity, Clock, AlertCircle). This mirrors the established battery/energy-page precedent
// (VampireDrainPageIcons): each glyph is authored locally as a 24×24 stroked vector and recolored at render via the
// Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.tirepressure

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

/**
 * The glyph set this surface needs (web lucide icons). All are authored locally as 24×24 stroked vectors and tinted at
 * render, so the page reads them from one source without touching the shared catalogs.
 */
object TireGlyphs {
    /** Gauge / speedometer — web `Gauge` (the current-readings + history headers). A dial arc with a needle. */
    val Gauge: ImageVector =
        strokedGlyph("TireGauge") {
            moveTo(4f, 17f)
            curveTo(2.7f, 15.3f, 2f, 13.2f, 2f, 11f)
            curveTo(2f, 5.5f, 6.5f, 1f, 12f, 1f)
            curveTo(17.5f, 1f, 22f, 5.5f, 22f, 11f)
            curveTo(22f, 13.2f, 21.3f, 15.3f, 20f, 17f)
            moveTo(12f, 11f)
            lineTo(15.5f, 7.5f)
        }

    /** Warning triangle with an exclamation — web `AlertTriangle` (the warning banner + warning-count tile). */
    val AlertTriangle: ImageVector =
        strokedGlyph("TireAlertTriangle") {
            moveTo(12f, 3f)
            lineTo(22f, 20f)
            lineTo(2f, 20f)
            close()
            moveTo(12f, 9f)
            lineTo(12f, 14f)
            moveTo(12f, 17f)
            lineTo(12f, 17.1f)
        }

    /** Down-trending line with an arrow — web `TrendingDown` (the min-pressure tile). */
    val TrendingDown: ImageVector =
        strokedGlyph("TireTrendingDown") {
            moveTo(3f, 7f)
            lineTo(10f, 14f)
            lineTo(14f, 10f)
            lineTo(21f, 17f)
            moveTo(21f, 11f)
            lineTo(21f, 17f)
            lineTo(15f, 17f)
        }

    /** Activity pulse line — web `Activity` (the avg-pressure tile). A baseline with a single spike. */
    val Activity: ImageVector =
        strokedGlyph("TireActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Clock face — web `Clock` (the last-updated tile + history-table header). */
    val Clock: ImageVector =
        strokedGlyph("TireClock") {
            moveTo(12f, 3f)
            curveTo(7f, 3f, 3f, 7f, 3f, 12f)
            curveTo(3f, 17f, 7f, 21f, 12f, 21f)
            curveTo(17f, 21f, 21f, 17f, 21f, 12f)
            curveTo(21f, 7f, 17f, 3f, 12f, 3f)
            close()
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** Circle with an exclamation — web `AlertCircle` (the inline load-error banner). */
    val AlertCircle: ImageVector =
        strokedGlyph("TireAlertCircle") {
            moveTo(12f, 3f)
            curveTo(7f, 3f, 3f, 7f, 3f, 12f)
            curveTo(3f, 17f, 7f, 21f, 12f, 21f)
            curveTo(17f, 21f, 21f, 17f, 21f, 12f)
            curveTo(21f, 7f, 17f, 3f, 12f, 3f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            moveTo(12f, 16f)
            lineTo(12f, 16.1f)
        }
}
