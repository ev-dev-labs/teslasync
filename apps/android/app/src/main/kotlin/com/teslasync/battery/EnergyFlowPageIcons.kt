// Locally-authored stroked vector glyphs for the EnergyFlowPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/battery/pages/EnergyFlowPage.tsx imports Battery, Car, Plug, Thermometer,
// Cpu, ArrowRight, ArrowDown, Zap, TrendingUp, Activity, BarChart3, Leaf, Calendar, Gauge). This mirrors the established
// analytics-page precedent (StatisticsPageIcons): glyphs the shared catalogs already carry are re-exported from those
// catalogs (Car / Zap=Bolt / Battery / Gauge / BarChart3=Chart / ArrowRight / ArrowDown / Activity=Pulse), and the
// remainder (Plug / Thermometer / Cpu / Leaf / TrendingUp / Calendar) are authored locally as 24×24 stroked vectors and
// recolored at render via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.energyflow

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
 * The glyph set this surface needs (web lucide icons). The eight glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other six are authored locally.
 */
object EnergyFlowGlyphs {
    /** Lightning bolt — web `Zap` (energy-flow header, DC power, total-energy). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Battery — web `Battery` (the SoC gauge node, total-energy). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Vehicle — web `Car` (the motor node, distance metric). Reused from the shared nav catalog. */
    val Car: ImageVector = NavGlyphs.Car

    /** Speedometer — web `Gauge` (the efficiency metric). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Bar chart — web `BarChart3` (the daily-distance + history headers). Reused from the shared nav catalog. */
    val Chart: ImageVector = NavGlyphs.Chart

    /** Activity line — web `Activity` (the daily-energy header, AC power). Reused from the shared nav catalog. */
    val Activity: ImageVector = NavGlyphs.Pulse

    /** Right arrow — web `ArrowRight` (the charging / driving flow arrows). Reused from the shared data-display catalog. */
    val ArrowRight: ImageVector = DataDisplayGlyphs.ArrowRight

    /** Down arrow — web `ArrowDown` (the vertical flow arrow variant). Reused from the shared data-display catalog. */
    val ArrowDown: ImageVector = DataDisplayGlyphs.ArrowDown

    /** Plug — web `Plug` (the grid node + total-charged). */
    val Plug: ImageVector =
        strokedGlyph("EnergyFlowPlug") {
            moveTo(9f, 3f)
            lineTo(9f, 8f)
            moveTo(15f, 3f)
            lineTo(15f, 8f)
            moveTo(6f, 8f)
            lineTo(18f, 8f)
            lineTo(18f, 11f)
            curveTo(18f, 14.3f, 15.3f, 17f, 12f, 17f)
            curveTo(8.7f, 17f, 6f, 14.3f, 6f, 11f)
            lineTo(6f, 8f)
            close()
            moveTo(12f, 17f)
            lineTo(12f, 21f)
        }

    /** Thermometer — web `Thermometer` (the HVAC node). */
    val Thermometer: ImageVector =
        strokedGlyph("EnergyFlowThermometer") {
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

    /** CPU — web `Cpu` (the accessories node). */
    val Cpu: ImageVector =
        strokedGlyph("EnergyFlowCpu") {
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 17f)
            lineTo(7f, 17f)
            close()
            moveTo(10f, 2f)
            lineTo(10f, 5f)
            moveTo(14f, 2f)
            lineTo(14f, 5f)
            moveTo(10f, 19f)
            lineTo(10f, 22f)
            moveTo(14f, 19f)
            lineTo(14f, 22f)
            moveTo(19f, 10f)
            lineTo(22f, 10f)
            moveTo(19f, 14f)
            lineTo(22f, 14f)
            moveTo(2f, 10f)
            lineTo(5f, 10f)
            moveTo(2f, 14f)
            lineTo(5f, 14f)
        }

    /** Leaf — web `Leaf` (CO₂ saved). */
    val Leaf: ImageVector =
        strokedGlyph("EnergyFlowLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14.5f, 9.5f)
        }

    /** Upward trend — web `TrendingUp` (daily efficiency + efficiency metrics). */
    val TrendingUp: ImageVector =
        strokedGlyph("EnergyFlowTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Calendar — web `Calendar` (the period card). */
    val Calendar: ImageVector =
        strokedGlyph("EnergyFlowCalendar") {
            moveTo(5f, 5f)
            lineTo(19f, 5f)
            lineTo(19f, 20f)
            lineTo(5f, 20f)
            close()
            moveTo(5f, 9f)
            lineTo(19f, 9f)
            moveTo(8f, 3f)
            lineTo(8f, 6f)
            moveTo(16f, 3f)
            lineTo(16f, 6f)
        }
}
