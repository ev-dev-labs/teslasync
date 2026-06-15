// Locally-authored stroked vector glyphs for the StatisticsPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/analytics/pages/StatisticsPage.tsx imports BarChart3, MapPin, Zap,
// DollarSign, Leaf, Battery, TrendingUp, Gauge, RefreshCw, Car, Clock). This mirrors the established analytics-page
// precedent (LifetimeStatsPageIcons): glyphs the shared catalogs already carry are re-exported from those catalogs
// (Car / Zap=Bolt / MapPin / Gauge / Battery / Clock / BarChart3=Chart / RefreshCw=Refresh), and the remainder
// (DollarSign / Leaf / TrendingUp) are authored locally as 24×24 stroked vectors and recolored at render via the Icon
// `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.statistics

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
 * re-exported so the page reads every icon from one source; the other three are authored locally.
 */
object StatisticsGlyphs {
    /** Vehicle — web `Car` (mileage drive count). Reused from the shared nav catalog. */
    val Car: ImageVector = NavGlyphs.Car

    /** Lightning bolt — web `Zap` (total-energy). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Map pin — web `MapPin` (distance metrics). Reused from the shared data-display catalog. */
    val MapPin: ImageVector = DataDisplayGlyphs.MapPin

    /** Speedometer — web `Gauge` (avg-efficiency). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Battery — web `Battery` (capacity). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Clock — web `Clock` (drive counts + empty-state). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Bar chart — web `BarChart3` (the no-data empty-state). Reused from the shared nav catalog. */
    val Chart: ImageVector = NavGlyphs.Chart

    /** Refresh cycle — web `RefreshCw` (battery cycles). Reused from the shared feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Dollar sign — web `DollarSign` (cost metrics). */
    val DollarSign: ImageVector =
        strokedGlyph("StatisticsDollarSign") {
            moveTo(16f, 7.5f)
            curveTo(16f, 6.1f, 14.2f, 5.5f, 12f, 5.5f)
            curveTo(9.8f, 5.5f, 8f, 6.4f, 8f, 8.2f)
            curveTo(8f, 12.5f, 16f, 10.5f, 16f, 14.8f)
            curveTo(16f, 16.8f, 14f, 17.5f, 12f, 17.5f)
            curveTo(9.8f, 17.5f, 8f, 16.9f, 8f, 15.5f)
            moveTo(12f, 3f)
            lineTo(12f, 5.5f)
            moveTo(12f, 17.5f)
            lineTo(12f, 21f)
        }

    /** Leaf — web `Leaf` (CO₂ saved). */
    val Leaf: ImageVector =
        strokedGlyph("StatisticsLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14.5f, 9.5f)
        }

    /** Upward trend — web `TrendingUp` (drives + degradation + projection). */
    val TrendingUp: ImageVector =
        strokedGlyph("StatisticsTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }
}
