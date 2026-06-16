// Locally-authored stroked vector glyphs for the ClimateControlPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/vehicle-systems/pages/ClimateControlPage.tsx imports Thermometer,
// Wind, Snowflake, Sun, Power, Flame, CircleGauge, Settings, ThermometerSun, RefreshCw, ShieldCheck,
// BatteryCharging, Zap, Activity, AlertTriangle, Monitor). This mirrors the established A7 page precedent
// (TemperatureImpactPageIcons): glyphs the shared catalogs already carry are re-exported (Snowflake /
// BatteryCharging / AlertTriangle / Bolt→Zap / Gauge→CircleGauge / Shield→ShieldCheck from the data-display
// catalog), and the remainder are authored locally as 24×24 stroked vectors and recoloured at render via the Icon
// `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.climatecontrol

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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/**
 * The glyph set this surface needs (web lucide icons). Six are re-exported from the shared data-display catalog so
 * the page reads every icon from one source; the rest are authored locally.
 */
object ClimateControlGlyphs {
    /** Snowflake — web `Snowflake` (defrost / rear-defrost / precondition / seat cooling / too-cold status). */
    val Snowflake: ImageVector = DataDisplayGlyphs.Snowflake

    /** Battery-with-bolt — web `BatteryCharging` (battery-heater card + banner chip). */
    val BatteryCharging: ImageVector = DataDisplayGlyphs.BatteryCharging

    /** Warning triangle — web `AlertTriangle` (insufficient-power-to-heat banner chip). */
    val AlertTriangle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Lightning bolt — web `Zap` (AC-on-time efficiency card). Reused from the shared catalog. */
    val Zap: ImageVector = DataDisplayGlyphs.Bolt

    /** Speedometer arc — web `CircleGauge` (steering-wheel-heater card + climate-history header). */
    val CircleGauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Shield — web `ShieldCheck` (overheat-protection card). Reused from the shared catalog. */
    val ShieldCheck: ImageVector = DataDisplayGlyphs.Shield

    /** Thermometer — web `Thermometer` (gauges, passenger setting, thermal comfort, temperature history). */
    val Thermometer: ImageVector =
        strokedGlyph("ClimateThermometer") {
            moveTo(12f, 3f)
            lineTo(12f, 14.5f)
            moveTo(12f, 14.5f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 12f, y1 = 20.5f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 12f, y1 = 14.5f)
        }

    /** Thermometer + sun rays — web `ThermometerSun` (climate keeper, driver set temp, overheat temp limit). */
    val ThermometerSun: ImageVector =
        strokedGlyph("ClimateThermometerSun") {
            moveTo(7f, 4f)
            lineTo(7f, 13.5f)
            moveTo(7f, 13.5f)
            arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 7f, y1 = 18.5f)
            arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 7f, y1 = 13.5f)
            moveTo(16f, 6f)
            lineTo(16f, 7.5f)
            moveTo(20.5f, 8f)
            lineTo(19.5f, 9f)
            moveTo(22f, 12.5f)
            lineTo(20.5f, 12.5f)
            moveTo(11.5f, 8f)
            lineTo(12.5f, 9f)
            moveTo(16f, 9f)
            arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 16f, y1 = 14f)
            arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 16f, y1 = 9f)
        }

    /** Fan / wind lines — web `Wind` (fan speed, fan status, AC & fan history, comfortable status). */
    val Wind: ImageVector =
        strokedGlyph("ClimateWind") {
            moveTo(4f, 9f)
            lineTo(13f, 9f)
            arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 10.5f, y1 = 6.5f)
            moveTo(3f, 14f)
            lineTo(16f, 14f)
            arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 13.5f, y1 = 16.5f)
            moveTo(6f, 18.5f)
            lineTo(18f, 18.5f)
            arcTo(2.5f, 2.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 15.5f, y1 = 16f)
        }

    /** Sun — web `Sun` (too-warm status tile). */
    val Sun: ImageVector =
        strokedGlyph("ClimateSun") {
            moveTo(12f, 8f)
            arcTo(4f, 4f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 16f)
            arcTo(4f, 4f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 8f)
            moveTo(12f, 2f)
            lineTo(12f, 4f)
            moveTo(12f, 20f)
            lineTo(12f, 22f)
            moveTo(2f, 12f)
            lineTo(4f, 12f)
            moveTo(20f, 12f)
            lineTo(22f, 12f)
            moveTo(4.9f, 4.9f)
            lineTo(6.3f, 6.3f)
            moveTo(17.7f, 17.7f)
            lineTo(19.1f, 19.1f)
            moveTo(4.9f, 19.1f)
            lineTo(6.3f, 17.7f)
            moveTo(17.7f, 6.3f)
            lineTo(19.1f, 4.9f)
        }

    /** Power button — web `Power` (HVAC banner + HVAC power card). */
    val Power: ImageVector =
        strokedGlyph("ClimatePower") {
            moveTo(12f, 3f)
            lineTo(12f, 12f)
            moveTo(7.5f, 6f)
            arcTo(7f, 7f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 16.5f, y1 = 6f)
        }

    /** Flame — web `Flame` (seat heaters, steering-wheel heat level, wiper heater). */
    val Flame: ImageVector =
        strokedGlyph("ClimateFlame") {
            moveTo(12f, 3f)
            curveTo(13f, 7f, 17f, 8.5f, 17f, 13f)
            arcTo(5f, 5f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 7f, y1 = 13f)
            curveTo(7f, 11f, 8f, 10f, 9f, 9.5f)
            curveTo(9.5f, 12f, 11f, 12.5f, 11f, 12.5f)
            curveTo(10.5f, 9.5f, 12f, 6f, 12f, 3f)
            close()
        }

    /** Gear — web `Settings` (auto conditioning card). */
    val Settings: ImageVector =
        strokedGlyph("ClimateSettings") {
            moveTo(12f, 9f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 15f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 9f)
            moveTo(12f, 2.5f)
            lineTo(12f, 5f)
            moveTo(12f, 19f)
            lineTo(12f, 21.5f)
            moveTo(2.5f, 12f)
            lineTo(5f, 12f)
            moveTo(19f, 12f)
            lineTo(21.5f, 12f)
            moveTo(5.3f, 5.3f)
            lineTo(7f, 7f)
            moveTo(17f, 17f)
            lineTo(18.7f, 18.7f)
            moveTo(5.3f, 18.7f)
            lineTo(7f, 17f)
            moveTo(17f, 7f)
            lineTo(18.7f, 5.3f)
        }

    /** Circular refresh arrows — web `RefreshCw` (the page-header refresh button). */
    val RefreshCw: ImageVector =
        strokedGlyph("ClimateRefresh") {
            moveTo(20f, 11f)
            arcTo(8f, 8f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 18f, y1 = 6.5f)
            moveTo(20f, 4f)
            lineTo(20f, 8f)
            lineTo(16f, 8f)
        }

    /** Activity pulse — web `Activity` (steering-wheel heat auto + climate efficiency header). */
    val Activity: ImageVector =
        strokedGlyph("ClimateActivity") {
            moveTo(3f, 12f)
            lineTo(8f, 12f)
            lineTo(11f, 4f)
            lineTo(15f, 20f)
            lineTo(18f, 12f)
            lineTo(21f, 12f)
        }

    /** Monitor / display — web `Monitor` (rear display HVAC card). */
    val Monitor: ImageVector =
        strokedGlyph("ClimateMonitor") {
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 15f)
            lineTo(4f, 15f)
            close()
            moveTo(9f, 19f)
            lineTo(15f, 19f)
            moveTo(12f, 15f)
            lineTo(12f, 19f)
            dot(12f, 19f)
        }
}
