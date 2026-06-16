// Locally-authored stroked vector glyphs for the PeriodComparePage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses: Car (Total Distance), TrendingUp (Total Drives), Zap (Energy Used),
// Gauge (Avg Efficiency), DollarSign (Total Cost), Leaf (CO₂ Saved), Lightbulb (Insights header),
// ArrowLeftRight (the fleet-comparison disambiguation banner), and Calendar (the empty-state icon). This mirrors
// the established admin-surface precedent (ApiLogsPage's glyph set): each glyph is authored locally as a 24×24
// stroked vector and recolored at render via the Icon/MetricCard `tint`, rather than depending on a
// material-icons-extended artifact the app does not ship.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.periodcompare

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/MetricCard `tint` at render. */
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
object PeriodCompareGlyphs {
    /** Side profile of a car — web `Car` (Total Distance metric). */
    val Car: ImageVector =
        strokedGlyph("PeriodCompareCar") {
            moveTo(4f, 14f)
            lineTo(5.5f, 9f)
            lineTo(18.5f, 9f)
            lineTo(20f, 14f)
            lineTo(20f, 17f)
            lineTo(4f, 17f)
            close()
            moveTo(7f, 17f)
            curveTo(7f, 18.1f, 6.1f, 19f, 5f, 19f)
            curveTo(3.9f, 19f, 3f, 18.1f, 3f, 17f)
            moveTo(21f, 17f)
            curveTo(21f, 18.1f, 20.1f, 19f, 19f, 19f)
            curveTo(17.9f, 19f, 17f, 18.1f, 17f, 17f)
        }

    /** Up-trending line with an arrow head — web `TrendingUp` (Total Drives metric). */
    val TrendingUp: ImageVector =
        strokedGlyph("PeriodCompareTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Lightning bolt — web `Zap` (Energy Used metric). */
    val Zap: ImageVector =
        strokedGlyph("PeriodCompareZap") {
            moveTo(13f, 3f)
            lineTo(5f, 13f)
            lineTo(11f, 13f)
            lineTo(11f, 21f)
            lineTo(19f, 11f)
            lineTo(13f, 11f)
            close()
        }

    /** Speedometer dial with a needle — web `Gauge` (Avg Efficiency metric). */
    val Gauge: ImageVector =
        strokedGlyph("PeriodCompareGauge") {
            moveTo(4f, 18f)
            curveTo(2.7f, 16.2f, 2f, 14.1f, 2f, 12f)
            curveTo(2f, 6.5f, 6.5f, 2f, 12f, 2f)
            curveTo(17.5f, 2f, 22f, 6.5f, 22f, 12f)
            curveTo(22f, 14.1f, 21.3f, 16.2f, 20f, 18f)
            moveTo(12f, 12f)
            lineTo(16f, 9f)
        }

    /** Dollar sign — web `DollarSign` (Total Cost metric). */
    val DollarSign: ImageVector =
        strokedGlyph("PeriodCompareDollarSign") {
            moveTo(12f, 3f)
            lineTo(12f, 21f)
            moveTo(16f, 7f)
            curveTo(16f, 5.3f, 14.2f, 4f, 12f, 4f)
            curveTo(9.8f, 4f, 8f, 5.3f, 8f, 7f)
            curveTo(8f, 8.7f, 9.8f, 10f, 12f, 10f)
            curveTo(14.2f, 10f, 16f, 11.3f, 16f, 13f)
            curveTo(16f, 14.7f, 14.2f, 16f, 12f, 16f)
            curveTo(9.8f, 16f, 8f, 14.7f, 8f, 13f)
        }

    /** Leaf — web `Leaf` (CO₂ Saved metric). */
    val Leaf: ImageVector =
        strokedGlyph("PeriodCompareLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 12f, 9f, 5f, 20f, 5f)
            curveTo(20f, 15f, 14f, 20f, 6f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(13f, 11f)
        }

    /** Lightbulb — web `Lightbulb` (Insights panel header). */
    val Lightbulb: ImageVector =
        strokedGlyph("PeriodCompareLightbulb") {
            moveTo(9f, 18f)
            lineTo(15f, 18f)
            moveTo(10f, 21f)
            lineTo(14f, 21f)
            moveTo(9f, 15f)
            curveTo(7.2f, 13.9f, 6f, 11.9f, 6f, 9.7f)
            curveTo(6f, 6.3f, 8.7f, 4f, 12f, 4f)
            curveTo(15.3f, 4f, 18f, 6.3f, 18f, 9.7f)
            curveTo(18f, 11.9f, 16.8f, 13.9f, 15f, 15f)
            close()
        }

    /** Two horizontal arrows pointing opposite ways — web `ArrowLeftRight` (disambiguation banner). */
    val ArrowLeftRight: ImageVector =
        strokedGlyph("PeriodCompareArrowLeftRight") {
            moveTo(7f, 7f)
            lineTo(4f, 10f)
            lineTo(7f, 13f)
            moveTo(4f, 10f)
            lineTo(20f, 10f)
            moveTo(17f, 11f)
            lineTo(20f, 14f)
            lineTo(17f, 17f)
            moveTo(20f, 14f)
            lineTo(4f, 14f)
        }

    /** Calendar — web `Calendar` (the empty-state icon). */
    val Calendar: ImageVector =
        strokedGlyph("PeriodCompareCalendar") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(4f, 10f)
            lineTo(20f, 10f)
            moveTo(8f, 3f)
            lineTo(8f, 7f)
            moveTo(16f, 3f)
            lineTo(16f, 7f)
        }
}
