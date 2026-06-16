// Locally-authored stroked vector glyphs for the EfficiencyPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/driving/pages/EfficiencyPage.tsx imports Zap, TrendingUp, Thermometer, Fuel,
// Gauge). This mirrors the established A7 precedent (BatteryHealthPageIcons / StatisticsPageIcons): glyphs the shared
// catalogs already carry are re-exported from those catalogs (Zap=Bolt / Gauge from the data-display catalog), and the
// remainder (TrendingUp / Thermometer / Fuel) are authored locally as 24×24 stroked vectors and recolored at render via
// the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.efficiency

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs

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
 * The glyph set this surface needs (web lucide icons). The two glyphs the shared catalogs already carry are re-exported
 * so the page reads every icon from one source; the other three are authored locally.
 */
object EfficiencyGlyphs {
    /** Lightning bolt — web `Zap` (avg-consumption stat card). Reused from the shared data-display catalog. */
    val Zap: ImageVector = DataDisplayGlyphs.Bolt

    /** Speedometer — web `Gauge` (drives-analyzed stat card). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Upward trend line + arrow — web `TrendingUp` (avg-speed stat card). */
    val TrendingUp: ImageVector =
        strokedGlyph("EfficiencyTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Thermometer — web `Thermometer` (temperature-range header). Stem plus a bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("EfficiencyThermometer") {
            moveTo(14f, 14.8f)
            lineTo(14f, 5f)
            curveTo(14f, 3.9f, 13.1f, 3f, 12f, 3f)
            curveTo(10.9f, 3f, 10f, 3.9f, 10f, 5f)
            lineTo(10f, 14.8f)
            curveTo(8.8f, 15.5f, 8f, 16.8f, 8f, 18.2f)
            curveTo(8f, 20.3f, 9.7f, 22f, 12f, 22f)
            curveTo(14.3f, 22f, 16f, 20.3f, 16f, 18.2f)
            curveTo(16f, 16.8f, 15.2f, 15.5f, 14f, 14.8f)
            close()
        }

    /** Fuel pump — web `Fuel` (estimated cost-per-km stat card). A tank plus a nozzle + feed line. */
    val Fuel: ImageVector =
        strokedGlyph("EfficiencyFuel") {
            moveTo(3f, 22f)
            lineTo(13f, 22f)
            moveTo(4f, 22f)
            lineTo(4f, 5f)
            curveTo(4f, 3.9f, 4.9f, 3f, 6f, 3f)
            lineTo(11f, 3f)
            curveTo(12.1f, 3f, 13f, 3.9f, 13f, 5f)
            lineTo(13f, 22f)
            moveTo(4f, 12f)
            lineTo(13f, 12f)
            moveTo(16f, 8f)
            lineTo(18.5f, 10.5f)
            curveTo(18.8f, 10.8f, 19f, 11.2f, 19f, 11.7f)
            lineTo(19f, 16.5f)
            curveTo(19f, 17.3f, 19.7f, 18f, 20.5f, 18f)
            curveTo(21.3f, 18f, 22f, 17.3f, 22f, 16.5f)
            lineTo(22f, 8.5f)
            lineTo(18f, 4.5f)
        }
}
