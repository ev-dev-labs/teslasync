// Locally-authored stroked vector glyphs for the DrivetrainHealthPage surface — the native counterparts of the web
// lucide icons the page renders (web DrivetrainHealthPage + drivetrain-health components import Zap, Cpu,
// BatteryCharging, CheckCircle, AlertTriangle, Activity, Thermometer, Heart, TrendingUp, Shield, Cog, Gauge). This
// mirrors the established battery-page precedent (BatteryHealthPageIcons): glyphs the shared catalogs already carry are
// re-exported from those catalogs (Zap=Bolt / BatteryCharging / CheckCircle / AlertTriangle / Shield / Gauge from the
// data-display catalog, Cog=Gear from the nav catalog), and the remainder (Cpu / Activity / Thermometer / Heart /
// TrendingUp) are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather than
// editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivetrainhealth

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.navigation.NavGlyphs

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
 * The glyph set this surface needs (web lucide icons). The seven glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other five are authored locally.
 */
object DrivetrainGlyphs {
    /** Lightning bolt — web `Zap` (motor sensors, power, torque). Reused from the shared data-display catalog. */
    val Zap: ImageVector = DataDisplayGlyphs.Bolt

    /** Charging battery — web `BatteryCharging` (battery sensor). Reused from the shared data-display catalog. */
    val BatteryCharging: ImageVector = DataDisplayGlyphs.BatteryCharging

    /** Check-in-circle — web `CheckCircle` (healthy hero). Reused from the shared data-display catalog. */
    val CheckCircle: ImageVector = DataDisplayGlyphs.CheckCircle

    /** Warning triangle — web `AlertTriangle` (warning/critical hero + recommendations). Reused from data-display. */
    val AlertTriangle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Shield — web `Shield` (regen ratio, HV isolation, recommendations header). Reused from the data-display catalog. */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Speedometer — web `Gauge` (the no-data empty surface). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Cog — web `Cog` (live motor status header). Reused from the shared nav catalog (Gear). */
    val Cog: ImageVector = NavGlyphs.Gear

    /** CPU — web `Cpu` (inverter sensor). A chip square with pins on each side. */
    val Cpu: ImageVector =
        strokedGlyph("DrivetrainCpu") {
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 17f)
            lineTo(7f, 17f)
            close()
            moveTo(10f, 10f)
            lineTo(14f, 10f)
            lineTo(14f, 14f)
            lineTo(10f, 14f)
            close()
            moveTo(9f, 3f)
            lineTo(9f, 5f)
            moveTo(15f, 3f)
            lineTo(15f, 5f)
            moveTo(9f, 19f)
            lineTo(9f, 21f)
            moveTo(15f, 19f)
            lineTo(15f, 21f)
            moveTo(3f, 9f)
            lineTo(5f, 9f)
            moveTo(3f, 15f)
            lineTo(5f, 15f)
            moveTo(19f, 9f)
            lineTo(21f, 9f)
            moveTo(19f, 15f)
            lineTo(21f, 15f)
        }

    /** Activity pulse line — web `Activity` (motor details, thermal load, live RPM). */
    val Activity: ImageVector =
        strokedGlyph("DrivetrainActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Thermometer — web `Thermometer` (temperature gauges + live temps). Stem plus a bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("DrivetrainThermometer") {
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

    /** Heart — web `Heart` (health-score metric card). */
    val Heart: ImageVector =
        strokedGlyph("DrivetrainHeart") {
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

    /** Upward trend line — web `TrendingUp` (avg power, recommendations). An up-right arrow over a baseline. */
    val TrendingUp: ImageVector =
        strokedGlyph("DrivetrainTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }
}
