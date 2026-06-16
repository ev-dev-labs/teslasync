// Locally-authored stroked vector glyphs for the AnalyticsPage surface — the native counterparts of the web
// lucide icons the page renders across its hero gauges, tabs, and metric cards
// (web/src/features/analytics/pages/AnalyticsPage.tsx + components/analytics/*: BarChart3, Car, Zap, Battery,
// MapPin, Gauge, DollarSign, Leaf, TrendingUp, BatteryCharging, Thermometer, Plug, Timer, Heart, Activity).
// This mirrors the established A7 precedent (SlowQueriesPageIcons / ApiLogsPageIcons): each glyph is authored
// locally as a 24×24 stroked vector and recolored at render via the Icon `tint`, rather than editing the
// shared TeslaGlyphs catalog (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics

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
object AnalyticsGlyphs {
    /** Three rising columns — web `BarChart3` (the Overview tab + hero structure). */
    val BarChart: ImageVector =
        strokedGlyph("AnalyticsBarChart") {
            moveTo(4f, 20f); lineTo(20f, 20f)
            moveTo(7f, 20f); lineTo(7f, 13f)
            moveTo(12f, 20f); lineTo(12f, 8f)
            moveTo(17f, 20f); lineTo(17f, 11f)
        }

    /** A simple car silhouette — web `Car` (the Driving tab + drives metric). */
    val Car: ImageVector =
        strokedGlyph("AnalyticsCar") {
            moveTo(4f, 14f); lineTo(5.6f, 8.5f); curveTo(5.9f, 7.6f, 6.7f, 7f, 7.6f, 7f)
            lineTo(16.4f, 7f); curveTo(17.3f, 7f, 18.1f, 7.6f, 18.4f, 8.5f); lineTo(20f, 14f)
            moveTo(4f, 14f); lineTo(20f, 14f); lineTo(20f, 17.5f); lineTo(4f, 17.5f); close()
            moveTo(7.5f, 17.5f); lineTo(7.5f, 19.5f)
            moveTo(16.5f, 17.5f); lineTo(16.5f, 19.5f)
        }

    /** A lightning bolt — web `Zap` (the Charging tab + energy metric). */
    val Zap: ImageVector =
        strokedGlyph("AnalyticsZap") {
            moveTo(13f, 2f); lineTo(4f, 13f); lineTo(11f, 13f); lineTo(11f, 22f); lineTo(20f, 11f); lineTo(13f, 11f); close()
        }

    /** A battery cell with terminal — web `Battery` (the Battery tab + health). */
    val Battery: ImageVector =
        strokedGlyph("AnalyticsBattery") {
            moveTo(3f, 8f); lineTo(17f, 8f); lineTo(17f, 16f); lineTo(3f, 16f); close()
            moveTo(20f, 11f); lineTo(20f, 13f)
        }

    /** A battery cell with an inner bolt — web `BatteryCharging` (peak regen). */
    val BatteryCharging: ImageVector =
        strokedGlyph("AnalyticsBatteryCharging") {
            moveTo(7f, 8f); lineTo(3f, 8f); lineTo(3f, 16f); lineTo(8f, 16f)
            moveTo(12f, 8f); lineTo(17f, 8f); lineTo(17f, 16f); lineTo(13f, 16f)
            moveTo(20f, 11f); lineTo(20f, 13f)
            moveTo(11f, 6f); lineTo(8f, 12f); lineTo(12f, 12f); lineTo(9f, 18f)
        }

    /** A located-pin teardrop with a dot — web `MapPin` (distance + range metrics). */
    val MapPin: ImageVector =
        strokedGlyph("AnalyticsMapPin") {
            moveTo(12f, 2f); curveTo(8.1f, 2f, 5f, 5.1f, 5f, 9f)
            curveTo(5f, 14.2f, 12f, 22f, 12f, 22f); curveTo(12f, 22f, 19f, 14.2f, 19f, 9f)
            curveTo(19f, 5.1f, 15.9f, 2f, 12f, 2f); close()
            moveTo(9.5f, 9f); curveTo(9.5f, 7.6f, 10.6f, 6.5f, 12f, 6.5f)
            curveTo(13.4f, 6.5f, 14.5f, 7.6f, 14.5f, 9f); curveTo(14.5f, 10.4f, 13.4f, 11.5f, 12f, 11.5f)
            curveTo(10.6f, 11.5f, 9.5f, 10.4f, 9.5f, 9f); close()
        }

    /** A dial gauge with a needle — web `Gauge` (efficiency + avg-power metrics). */
    val Gauge: ImageVector =
        strokedGlyph("AnalyticsGauge") {
            moveTo(4f, 17f); curveTo(3.4f, 15.5f, 3.4f, 13.8f, 4.1f, 12.3f)
            curveTo(4.8f, 10.8f, 6.1f, 9.6f, 7.7f, 9f); curveTo(9.3f, 8.4f, 11f, 8.4f, 12.6f, 9f)
            curveTo(15.6f, 10.1f, 17.4f, 13.2f, 16.9f, 16.4f)
            moveTo(12f, 13f); lineTo(15f, 10.5f)
        }

    /** A dollar sign — web `DollarSign` (gas-savings + cost metrics). */
    val DollarSign: ImageVector =
        strokedGlyph("AnalyticsDollarSign") {
            moveTo(12f, 3f); lineTo(12f, 21f)
            moveTo(16f, 7.5f); curveTo(15f, 6.3f, 13.5f, 5.7f, 12f, 5.7f)
            curveTo(9.8f, 5.7f, 8f, 7f, 8f, 9f); curveTo(8f, 11f, 9.8f, 11.8f, 12f, 12f)
            curveTo(14.2f, 12.2f, 16f, 13f, 16f, 15f); curveTo(16f, 17f, 14.2f, 18.3f, 12f, 18.3f)
            curveTo(10.5f, 18.3f, 9f, 17.7f, 8f, 16.5f)
        }

    /** A leaf — web `Leaf` (CO₂-saved metric). */
    val Leaf: ImageVector =
        strokedGlyph("AnalyticsLeaf") {
            moveTo(4f, 20f); curveTo(4f, 12f, 9f, 5f, 20f, 4f); curveTo(20f, 13f, 14f, 20f, 4f, 20f); close()
            moveTo(7f, 17f); curveTo(10f, 11f, 14f, 8f, 17f, 7f)
        }

    /** An up-and-to-the-right trend arrow — web `TrendingUp` (avg-speed + degradation metrics). */
    val TrendingUp: ImageVector =
        strokedGlyph("AnalyticsTrendingUp") {
            moveTo(3f, 17f); lineTo(9f, 11f); lineTo(13f, 15f); lineTo(21f, 7f)
            moveTo(15f, 7f); lineTo(21f, 7f); lineTo(21f, 13f)
        }

    /** A bulb thermometer — web `Thermometer` (temperature stats). */
    val Thermometer: ImageVector =
        strokedGlyph("AnalyticsThermometer") {
            moveTo(10f, 13.5f); lineTo(10f, 5f); curveTo(10f, 3.9f, 10.9f, 3f, 12f, 3f)
            curveTo(13.1f, 3f, 14f, 3.9f, 14f, 5f); lineTo(14f, 13.5f)
            curveTo(15.2f, 14.3f, 15.8f, 15.8f, 15.4f, 17.2f); curveTo(15f, 18.7f, 13.6f, 19.7f, 12f, 19.7f)
            curveTo(10.4f, 19.7f, 9f, 18.7f, 8.6f, 17.2f); curveTo(8.2f, 15.8f, 8.8f, 14.3f, 10f, 13.5f); close()
        }

    /** A plug — web `Plug` (charging sessions metric). */
    val Plug: ImageVector =
        strokedGlyph("AnalyticsPlug") {
            moveTo(9f, 3f); lineTo(9f, 8f)
            moveTo(15f, 3f); lineTo(15f, 8f)
            moveTo(6f, 8f); lineTo(18f, 8f); lineTo(18f, 11f)
            curveTo(18f, 14.3f, 15.3f, 17f, 12f, 17f); curveTo(8.7f, 17f, 6f, 14.3f, 6f, 11f); close()
            moveTo(12f, 17f); lineTo(12f, 21f)
        }

    /** A stopwatch — web `Timer` (avg-duration metric). */
    val Timer: ImageVector =
        strokedGlyph("AnalyticsTimer") {
            moveTo(10f, 2.5f); lineTo(14f, 2.5f)
            moveTo(12f, 6f); curveTo(7.6f, 6f, 4f, 9.6f, 4f, 14f); curveTo(4f, 18.4f, 7.6f, 22f, 12f, 22f)
            curveTo(16.4f, 22f, 20f, 18.4f, 20f, 14f); curveTo(20f, 9.6f, 16.4f, 6f, 12f, 6f); close()
            moveTo(12f, 14f); lineTo(15f, 11f)
        }

    /** A heart — web `Heart` (battery health-score metric). */
    val Heart: ImageVector =
        strokedGlyph("AnalyticsHeart") {
            moveTo(12f, 20f); lineTo(4.5f, 12.5f); curveTo(2.8f, 10.8f, 2.8f, 8f, 4.5f, 6.3f)
            curveTo(6.2f, 4.6f, 9f, 4.6f, 10.7f, 6.3f); lineTo(12f, 7.6f); lineTo(13.3f, 6.3f)
            curveTo(15f, 4.6f, 17.8f, 4.6f, 19.5f, 6.3f); curveTo(21.2f, 8f, 21.2f, 10.8f, 19.5f, 12.5f); close()
        }

    /** A heartbeat pulse line — web `Activity` (battery cycles metric). */
    val Activity: ImageVector =
        strokedGlyph("AnalyticsActivity") {
            moveTo(3f, 12f); lineTo(8f, 12f); lineTo(10.5f, 5f); lineTo(14f, 19f); lineTo(16.5f, 12f); lineTo(21f, 12f)
        }
}
