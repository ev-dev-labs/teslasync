// Locally-authored stroked vector glyphs for the BatteryHealthPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/battery/pages/BatteryHealthPage.tsx imports Heart, Battery, BatteryFull,
// Gauge, RefreshCcw, Clock, Zap, ArrowRight, Lightbulb, AlertTriangle, CheckCircle, Info, Target, Activity,
// Thermometer, ThermometerSun, ThermometerSnowflake, Flame). This mirrors the established analytics-page precedent
// (StatisticsPageIcons): glyphs the shared catalogs already carry are re-exported from those catalogs (Battery /
// Gauge / Clock / Zap=Bolt / ArrowRight / AlertTriangle / CheckCircle / Info / RefreshCcw=Refresh), and the remainder
// (Heart / BatteryFull / Lightbulb / Target / Activity / Thermometer / ThermometerSun / ThermometerSnowflake / Flame)
// are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather than editing the
// shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.batteryhealth

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.FeedbackGlyphs

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
 * The glyph set this surface needs (web lucide icons). The nine glyphs the shared catalogs already carry are re-exported
 * so the page reads every icon from one source; the other nine are authored locally.
 */
object BatteryGlyphs {
    /** Battery — web `Battery` (capacity metrics). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Speedometer — web `Gauge` (degradation rate + charging stats). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Clock — web `Clock` (battery age). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Lightning bolt — web `Zap` (charge-level distribution). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Right arrow — web `ArrowRight` (quick links). Reused from the shared data-display catalog. */
    val ArrowRight: ImageVector = DataDisplayGlyphs.ArrowRight

    /** Warning triangle — web `AlertTriangle` (warning insights). Reused from the shared data-display catalog. */
    val AlertTriangle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Check-in-circle — web `CheckCircle` (good insights + full-charge). Reused from the shared data-display catalog. */
    val CheckCircle: ImageVector = DataDisplayGlyphs.CheckCircle

    /** Info-in-circle — web `Info` (neutral insights). Reused from the shared data-display catalog. */
    val Info: ImageVector = DataDisplayGlyphs.Info

    /** Refresh cycle — web `RefreshCcw` (total cycles). Reused from the shared feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Heart — web `Heart` (state-of-health hero + smart-insights header). */
    val Heart: ImageVector =
        strokedGlyph("BatteryHeart") {
            moveTo(12f, 20f)
            lineTo(4.5f, 12.5f)
            curveTo(2.5f, 10.5f, 2.5f, 7.5f, 4.5f, 6f)
            curveTo(6.3f, 4.6f, 9f, 5f, 10.5f, 6.8f)
            lineTo(12f, 8.5f)
            lineTo(13.5f, 6.8f)
            curveTo(15f, 5f, 17.7f, 4.6f, 19.5f, 6f)
            curveTo(21.5f, 7.5f, 21.5f, 10.5f, 19.5f, 12.5f)
            close()
        }

    /** Full battery — web `BatteryFull` (original capacity). Battery outline plus three fill bars + terminal. */
    val BatteryFull: ImageVector =
        strokedGlyph("BatteryFull") {
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

    /** Lightbulb — web `Lightbulb` (recommendations). Bulb circle plus the screw base. */
    val Lightbulb: ImageVector =
        strokedGlyph("BatteryLightbulb") {
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

    /** Target — web `Target` (low-degradation insight). Concentric rings plus a center dot. */
    val Target: ImageVector =
        strokedGlyph("BatteryTarget") {
            moveTo(21f, 12f)
            arcTo(9f, 9f, 0f, true, true, 3f, 12f)
            arcTo(9f, 9f, 0f, true, true, 21f, 12f)
            close()
            moveTo(16.5f, 12f)
            arcTo(4.5f, 4.5f, 0f, true, true, 7.5f, 12f)
            arcTo(4.5f, 4.5f, 0f, true, true, 16.5f, 12f)
            close()
            moveTo(12.5f, 12f)
            arcTo(0.5f, 0.5f, 0f, true, true, 11.5f, 12f)
            arcTo(0.5f, 0.5f, 0f, true, true, 12.5f, 12f)
            close()
        }

    /** Activity pulse line — web `Activity` (temperature spread + capacity comparison). */
    val Activity: ImageVector =
        strokedGlyph("BatteryActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Thermometer — web `Thermometer` (thermal monitoring header). Stem plus a bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("BatteryThermometer") {
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

    /** Hot thermometer — web `ThermometerSun` (max module temp). Thermometer stem plus a small sun. */
    val ThermometerSun: ImageVector =
        strokedGlyph("BatteryThermometerSun") {
            moveTo(7f, 15.5f)
            lineTo(7f, 6f)
            curveTo(7f, 4.9f, 7.9f, 4f, 9f, 4f)
            curveTo(10.1f, 4f, 11f, 4.9f, 11f, 6f)
            lineTo(11f, 15.5f)
            curveTo(12f, 16.2f, 12.6f, 17.3f, 12.6f, 18.5f)
            curveTo(12.6f, 20.4f, 11f, 22f, 9f, 22f)
            curveTo(7f, 22f, 5.4f, 20.4f, 5.4f, 18.5f)
            curveTo(5.4f, 17.3f, 6f, 16.2f, 7f, 15.5f)
            close()
            moveTo(18f, 5f)
            lineTo(18f, 3f)
            moveTo(18f, 13f)
            lineTo(18f, 11f)
            moveTo(14.5f, 8f)
            lineTo(21.5f, 8f)
            moveTo(19.5f, 8f)
            arcTo(1.5f, 1.5f, 0f, true, true, 16.5f, 8f)
            arcTo(1.5f, 1.5f, 0f, true, true, 19.5f, 8f)
            close()
        }

    /** Cold thermometer — web `ThermometerSnowflake` (min module temp). Thermometer stem plus a snowflake. */
    val ThermometerSnowflake: ImageVector =
        strokedGlyph("BatteryThermometerSnowflake") {
            moveTo(7f, 15.5f)
            lineTo(7f, 6f)
            curveTo(7f, 4.9f, 7.9f, 4f, 9f, 4f)
            curveTo(10.1f, 4f, 11f, 4.9f, 11f, 6f)
            lineTo(11f, 15.5f)
            curveTo(12f, 16.2f, 12.6f, 17.3f, 12.6f, 18.5f)
            curveTo(12.6f, 20.4f, 11f, 22f, 9f, 22f)
            curveTo(7f, 22f, 5.4f, 20.4f, 5.4f, 18.5f)
            curveTo(5.4f, 17.3f, 6f, 16.2f, 7f, 15.5f)
            close()
            moveTo(18f, 4f)
            lineTo(18f, 12f)
            moveTo(15f, 5.5f)
            lineTo(18f, 8f)
            lineTo(21f, 5.5f)
            moveTo(15f, 10.5f)
            lineTo(18f, 8f)
            lineTo(21f, 10.5f)
        }

    /** Flame — web `Flame` (battery heater). A teardrop flame with an inner curl. */
    val Flame: ImageVector =
        strokedGlyph("BatteryFlame") {
            moveTo(12f, 3f)
            curveTo(12f, 3f, 7f, 7f, 7f, 13f)
            curveTo(7f, 16.9f, 9.2f, 20f, 12f, 20f)
            curveTo(14.8f, 20f, 17f, 16.9f, 17f, 13f)
            curveTo(17f, 11f, 16f, 9.5f, 15f, 8.5f)
            curveTo(15f, 11f, 13.5f, 12f, 12.5f, 12f)
            curveTo(11.7f, 12f, 11f, 11.3f, 11f, 10.5f)
            curveTo(11f, 8f, 12f, 5f, 12f, 3f)
            close()
        }
}
