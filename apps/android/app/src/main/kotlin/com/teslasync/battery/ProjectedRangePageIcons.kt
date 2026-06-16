// Locally-authored stroked vector glyphs for the ProjectedRangePage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/battery/pages/ProjectedRangePage.tsx imports Gauge, TrendingUp, Thermometer,
// Wind, Mountain, Car, Lightbulb, Zap, BatteryFull, Shield, Snowflake). This mirrors the established battery-page
// precedent (BatteryHealthPageIcons): glyphs the shared catalogs already carry are re-exported from those catalogs
// (Gauge / Zap=Bolt), and the remainder (TrendingUp / Thermometer / Wind / Mountain / Car / Lightbulb / BatteryFull /
// Shield / Snowflake) are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather
// than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.projectedrange

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
 * so the page reads every icon from one source; the other nine are authored locally.
 */
object RangeGlyphs {
    /** Speedometer — web `Gauge` (efficiency gauge + default factor). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Lightning bolt — web `Zap` (usable capacity + default scenario). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Up-trend line — web `TrendingUp` (your estimate + projection curve). Polyline with a corner arrowhead. */
    val TrendingUp: ImageVector =
        strokedGlyph("RangeTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Thermometer — web `Thermometer` (temperature factor + precondition tip). Stem plus a bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("RangeThermometer") {
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

    /** Wind — web `Wind` (HVAC factor + seat-heater tip). Three swept air lines with hooked ends. */
    val Wind: ImageVector =
        strokedGlyph("RangeWind") {
            moveTo(3f, 8f)
            lineTo(13f, 8f)
            curveTo(14.7f, 8f, 16f, 6.7f, 16f, 5f)
            curveTo(16f, 3.3f, 14.7f, 2f, 13f, 2f)
            curveTo(11.3f, 2f, 10f, 3.3f, 10f, 5f)
            moveTo(3f, 12f)
            lineTo(17f, 12f)
            curveTo(18.7f, 12f, 20f, 13.3f, 20f, 15f)
            curveTo(20f, 16.7f, 18.7f, 18f, 17f, 18f)
            curveTo(15.3f, 18f, 14f, 16.7f, 14f, 15f)
            moveTo(3f, 16f)
            lineTo(8f, 16f)
            curveTo(9.7f, 16f, 11f, 17.3f, 11f, 19f)
            curveTo(11f, 20.7f, 9.7f, 22f, 8f, 22f)
            curveTo(6.3f, 22f, 5f, 20.7f, 5f, 19f)
        }

    /** Mountain — web `Mountain` (elevation factor). Two stroked peaks above a baseline. */
    val Mountain: ImageVector =
        strokedGlyph("RangeMountain") {
            moveTo(3f, 19f)
            lineTo(9f, 8f)
            lineTo(13f, 14f)
            lineTo(16f, 9f)
            lineTo(21f, 19f)
            close()
        }

    /** Car — web `Car` (tesla estimate + speed factor + fast scenario). Cabin body over two wheels. */
    val Car: ImageVector =
        strokedGlyph("RangeCar") {
            moveTo(3f, 13f)
            lineTo(5f, 8f)
            curveTo(5.3f, 7.4f, 5.9f, 7f, 6.6f, 7f)
            lineTo(17.4f, 7f)
            curveTo(18.1f, 7f, 18.7f, 7.4f, 19f, 8f)
            lineTo(21f, 13f)
            lineTo(21f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(8f, 16f)
            arcTo(1.5f, 1.5f, 0f, true, true, 5f, 16f)
            arcTo(1.5f, 1.5f, 0f, true, true, 8f, 16f)
            close()
            moveTo(19f, 16f)
            arcTo(1.5f, 1.5f, 0f, true, true, 16f, 16f)
            arcTo(1.5f, 1.5f, 0f, true, true, 19f, 16f)
            close()
        }

    /** Lightbulb — web `Lightbulb` (tips header). Bulb circle plus the screw base. */
    val Lightbulb: ImageVector =
        strokedGlyph("RangeLightbulb") {
            moveTo(9f, 18f)
            lineTo(15f, 18f)
            moveTo(10f, 21f)
            lineTo(14f, 21f)
            moveTo(12f, 3f)
            curveTo(8.7f, 3f, 6f, 5.7f, 6f, 9f)
            curveTo(6f, 11.4f, 7.4f, 13.2f, 9f, 14.5f)
            lineTo(9f, 16f)
            lineTo(15f, 16f)
            lineTo(15f, 14.5f)
            curveTo(16.6f, 13.2f, 18f, 11.4f, 18f, 9f)
            curveTo(18f, 5.7f, 15.3f, 3f, 12f, 3f)
            close()
        }

    /** Full battery — web `BatteryFull` (battery metric). Battery outline plus three fill bars + terminal. */
    val BatteryFull: ImageVector =
        strokedGlyph("RangeBatteryFull") {
            moveTo(3f, 8f)
            lineTo(16f, 8f)
            lineTo(16f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(19f, 10.5f)
            lineTo(19f, 13.5f)
            moveTo(6f, 10.5f)
            lineTo(6f, 13.5f)
            moveTo(9.5f, 10.5f)
            lineTo(9.5f, 13.5f)
            moveTo(13f, 10.5f)
            lineTo(13f, 13.5f)
        }

    /** Shield — web `Shield` (health factor + sentry scenario). A crest outline. */
    val Shield: ImageVector =
        strokedGlyph("RangeShield") {
            moveTo(12f, 3f)
            lineTo(20f, 6f)
            lineTo(20f, 11f)
            curveTo(20f, 16f, 16.5f, 19.5f, 12f, 21f)
            curveTo(7.5f, 19.5f, 4f, 16f, 4f, 11f)
            lineTo(4f, 6f)
            close()
        }

    /** Snowflake — web `Snowflake` (cold scenario). A six-spoke star through the center. */
    val Snowflake: ImageVector =
        strokedGlyph("RangeSnowflake") {
            moveTo(12f, 2f)
            lineTo(12f, 22f)
            moveTo(4f, 7f)
            lineTo(20f, 17f)
            moveTo(20f, 7f)
            lineTo(4f, 17f)
            moveTo(9f, 4f)
            lineTo(12f, 7f)
            lineTo(15f, 4f)
            moveTo(9f, 20f)
            lineTo(12f, 17f)
            lineTo(15f, 20f)
        }
}
