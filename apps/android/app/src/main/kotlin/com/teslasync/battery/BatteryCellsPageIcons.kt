// Locally-authored stroked vector glyphs for the BatteryCellsPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/battery/pages/BatteryCellsPage.tsx imports Battery, Cpu, Activity,
// TrendingDown, BarChart3, Grid3x3, ArrowDownRight, ArrowUpRight, Minus, Thermometer, Zap, CheckCircle, AlertTriangle,
// Shield, Info). This mirrors the established analytics-page precedent (StatisticsPageIcons): glyphs the shared
// catalogs already carry are re-exported from those catalogs (Battery / Zap=Bolt / TrendingDown / CheckCircle /
// AlertTriangle / Shield / Info / BarChart3=Chart), and the remainder (Cpu / Activity / Grid3x3 / ArrowDownRight /
// ArrowUpRight / Minus / Thermometer) are authored locally as 24×24 stroked vectors and recolored at render via the
// Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.batterycells

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
 * re-exported so the page reads every icon from one source; the other seven are authored locally.
 */
object BatteryCellsGlyphs {
    /** Battery — web `Battery` (avg-voltage card, cell-details empty). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Lightning bolt — web `Zap` (high-spread insight). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Downward trend — web `TrendingDown` (critical-cell status icon). Reused from the shared data-display catalog. */
    val TrendingDown: ImageVector = DataDisplayGlyphs.TrendingDown

    /** Check circle — web `CheckCircle` (balanced insight). Reused from the shared data-display catalog. */
    val CheckCircle: ImageVector = DataDisplayGlyphs.CheckCircle

    /** Warning triangle — web `AlertTriangle` (critical-cells insight). Reused from the shared data-display catalog. */
    val AlertTriangle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Shield — web `Shield` (recommendations header, healthy insight). Reused from the shared data-display catalog. */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Info — web `Info` (no-insights empty state). Reused from the shared data-display catalog. */
    val Info: ImageVector = DataDisplayGlyphs.Info

    /** Bar chart — web `BarChart3` (heatmap toggle to bar view). Reused from the shared nav catalog. */
    val Chart: ImageVector = NavGlyphs.Chart

    /** CPU — web `Cpu` (pack-voltage card). A chip square with leads. */
    val Cpu: ImageVector =
        strokedGlyph("BatteryCellsCpu") {
            moveTo(9f, 9f)
            lineTo(15f, 9f)
            lineTo(15f, 15f)
            lineTo(9f, 15f)
            close()
            moveTo(9f, 2f)
            lineTo(9f, 4f)
            moveTo(15f, 2f)
            lineTo(15f, 4f)
            moveTo(9f, 20f)
            lineTo(9f, 22f)
            moveTo(15f, 20f)
            lineTo(15f, 22f)
            moveTo(2f, 9f)
            lineTo(4f, 9f)
            moveTo(2f, 15f)
            lineTo(4f, 15f)
            moveTo(20f, 9f)
            lineTo(22f, 9f)
            moveTo(20f, 15f)
            lineTo(22f, 15f)
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
        }

    /** Activity — web `Activity` (imbalance card, spread-trend empty). An ECG pulse line. */
    val Activity: ImageVector =
        strokedGlyph("BatteryCellsActivity") {
            moveTo(2f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(22f, 12f)
        }

    /** Grid — web `Grid3x3` (heatmap toggle to grid view, heatmap-empty state). A 3×3 lattice. */
    val Grid: ImageVector =
        strokedGlyph("BatteryCellsGrid") {
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(9.33f, 4f)
            lineTo(9.33f, 20f)
            moveTo(14.66f, 4f)
            lineTo(14.66f, 20f)
            moveTo(4f, 9.33f)
            lineTo(20f, 9.33f)
            moveTo(4f, 14.66f)
            lineTo(20f, 14.66f)
        }

    /** Arrow down-right — web `ArrowDownRight` (min-cell card, low-status icon). */
    val ArrowDownRight: ImageVector =
        strokedGlyph("BatteryCellsArrowDownRight") {
            moveTo(7f, 7f)
            lineTo(17f, 17f)
            moveTo(17f, 9f)
            lineTo(17f, 17f)
            lineTo(9f, 17f)
        }

    /** Arrow up-right — web `ArrowUpRight` (max-cell card, high-status icon). */
    val ArrowUpRight: ImageVector =
        strokedGlyph("BatteryCellsArrowUpRight") {
            moveTo(7f, 17f)
            lineTo(17f, 7f)
            moveTo(9f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 15f)
        }

    /** Minus — web `Minus` (normal-status icon). A single bar. */
    val Minus: ImageVector =
        strokedGlyph("BatteryCellsMinus") {
            moveTo(5f, 12f)
            lineTo(19f, 12f)
        }

    /** Thermometer — web `Thermometer` (temperature cards + insight). A stem with a bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("BatteryCellsThermometer") {
            moveTo(14f, 14.76f)
            lineTo(14f, 5f)
            curveTo(14f, 3.62f, 12.88f, 2.5f, 11.5f, 2.5f)
            curveTo(10.12f, 2.5f, 9f, 3.62f, 9f, 5f)
            lineTo(9f, 14.76f)
            curveTo(7.79f, 15.57f, 7f, 16.95f, 7f, 18.5f)
            curveTo(7f, 20.99f, 9.01f, 23f, 11.5f, 23f)
            curveTo(13.99f, 23f, 16f, 20.99f, 16f, 18.5f)
            curveTo(16f, 16.95f, 15.21f, 15.57f, 14f, 14.76f)
            close()
        }
}
