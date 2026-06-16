// Locally-authored stroked vector glyphs for the DriveScorePage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/driving/pages/DriveScorePage.tsx via `@/lib/icons`: Car/drive, Star, Trophy,
// Award, Target, Lightbulb, charging/Zap, efficiency/Gauge, speed, TrendingUp/Down, AlertTriangle, Shield, MapPin,
// Clock, the sort chevrons and the delta arrows). This mirrors the established analytics-page precedent
// (StatisticsPageIcons): glyphs the shared catalogs already carry are re-exported from those catalogs, and the
// remainder are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather than
// editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivescore

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.TeslaGlyphs
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
 * The glyph set this surface needs (web lucide icons). The glyphs the shared catalogs already carry are re-exported so
 * the page reads every icon from one source; the remainder are authored locally.
 */
object DriveScoreGlyphs {
    /** Vehicle — web `drive`/`Car` (first-drive achievement, total-drives StatCard). Reused from the shared nav catalog. */
    val Car: ImageVector = NavGlyphs.Car

    /** Route line — web `Route` (drive-history route column). Reused from the shared nav catalog. */
    val Route: ImageVector = NavGlyphs.Route

    /** Lightning bolt — web `charging`/`Zap` (efficiency metrics + achievement). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Speedometer — web `efficiency`/`speed`/`Gauge` (smoothness + speed InlineMetrics). Reused from the shared catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Map pin — web `MapPin` (distance metrics). Reused from the shared data-display catalog. */
    val MapPin: ImageVector = DataDisplayGlyphs.MapPin

    /** Clock — web `Clock` (duration metrics). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Shield — web `securityCheck` (smooth-operator achievement). Reused from the shared data-display catalog. */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Warning triangle — web `severityWarn` (worst-drive header + tip). Reused from the shared data-display catalog. */
    val Warn: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Downward trend — web `trendDown` (declining trend chip). Reused from the shared data-display catalog. */
    val TrendingDown: ImageVector = DataDisplayGlyphs.TrendingDown

    /** Flat marker — web `remove` (stable trend chip). Reused from the shared ui catalog. */
    val Flat: ImageVector = TeslaGlyphs.Minus

    /** Upward delta — web `drillThrough` (week/month improvement). Reused from the shared data-display catalog. */
    val ArrowUp: ImageVector = DataDisplayGlyphs.ArrowUp

    /** Downward delta — web `drillDown` (week/month decline). Reused from the shared data-display catalog. */
    val ArrowDown: ImageVector = DataDisplayGlyphs.ArrowDown

    /** Sort-ascending chevron — web `collapse`. Reused from the shared ui catalog. */
    val ChevronUp: ImageVector = TeslaGlyphs.ChevronUp

    /** Sort-descending chevron — web `expand`. Reused from the shared ui catalog. */
    val ChevronDown: ImageVector = TeslaGlyphs.ChevronDown

    /** Star — web `star` (ten-drives achievement, best-drive header + tip). */
    val Star: ImageVector =
        strokedGlyph("DriveScoreStar") {
            moveTo(12f, 3f)
            lineTo(14.6f, 8.6f)
            lineTo(20.5f, 9.4f)
            lineTo(16.2f, 13.6f)
            lineTo(17.3f, 19.6f)
            lineTo(12f, 16.8f)
            lineTo(6.7f, 19.6f)
            lineTo(7.8f, 13.6f)
            lineTo(3.5f, 9.4f)
            lineTo(9.4f, 8.6f)
            close()
        }

    /** Trophy — web `trophy` (fifty-drives + A+-streak achievements, best-score StatCard). */
    val Trophy: ImageVector =
        strokedGlyph("DriveScoreTrophy") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 9f)
            curveTo(17f, 12f, 14.8f, 14f, 12f, 14f)
            curveTo(9.2f, 14f, 7f, 12f, 7f, 9f)
            close()
            moveTo(7f, 5.5f)
            lineTo(4f, 5.5f)
            lineTo(4f, 8f)
            curveTo(4f, 9.7f, 5.3f, 11f, 7f, 11f)
            moveTo(17f, 5.5f)
            lineTo(20f, 5.5f)
            lineTo(20f, 8f)
            curveTo(20f, 9.7f, 18.7f, 11f, 17f, 11f)
            moveTo(12f, 14f)
            lineTo(12f, 18f)
            moveTo(8.5f, 20f)
            lineTo(15.5f, 20f)
            moveTo(10f, 18f)
            lineTo(14f, 18f)
        }

    /** Award medal — web `award` (perfect-score achievement). */
    val Award: ImageVector =
        strokedGlyph("DriveScoreAward") {
            moveTo(12f, 3f)
            curveTo(15.3f, 3f, 18f, 5.7f, 18f, 9f)
            curveTo(18f, 12.3f, 15.3f, 15f, 12f, 15f)
            curveTo(8.7f, 15f, 6f, 12.3f, 6f, 9f)
            curveTo(6f, 5.7f, 8.7f, 3f, 12f, 3f)
            close()
            moveTo(9f, 14f)
            lineTo(7.5f, 21f)
            lineTo(12f, 18.5f)
            lineTo(16.5f, 21f)
            lineTo(15f, 14f)
        }

    /** Target — web `target` (speed-saint achievement, avg-score StatCard). */
    val Target: ImageVector =
        strokedGlyph("DriveScoreTarget") {
            moveTo(12f, 3f)
            curveTo(16.97f, 3f, 21f, 7.03f, 21f, 12f)
            curveTo(21f, 16.97f, 16.97f, 21f, 12f, 21f)
            curveTo(7.03f, 21f, 3f, 16.97f, 3f, 12f)
            curveTo(3f, 7.03f, 7.03f, 3f, 12f, 3f)
            close()
            moveTo(12f, 7f)
            curveTo(14.76f, 7f, 17f, 9.24f, 17f, 12f)
            curveTo(17f, 14.76f, 14.76f, 17f, 12f, 17f)
            curveTo(9.24f, 17f, 7f, 14.76f, 7f, 12f)
            curveTo(7f, 9.24f, 9.24f, 7f, 12f, 7f)
            close()
            moveTo(12f, 11f)
            curveTo(12.55f, 11f, 13f, 11.45f, 13f, 12f)
            curveTo(13f, 12.55f, 12.55f, 13f, 12f, 13f)
            curveTo(11.45f, 13f, 11f, 12.55f, 11f, 12f)
            curveTo(11f, 11.45f, 11.45f, 11f, 12f, 11f)
            close()
        }

    /** Lightbulb — web `lightbulb` (improvement tips). */
    val Lightbulb: ImageVector =
        strokedGlyph("DriveScoreLightbulb") {
            moveTo(12f, 3f)
            curveTo(8.7f, 3f, 6f, 5.7f, 6f, 9f)
            curveTo(6f, 11.2f, 7.2f, 13.1f, 9f, 14.2f)
            lineTo(9f, 16.5f)
            lineTo(15f, 16.5f)
            lineTo(15f, 14.2f)
            curveTo(16.8f, 13.1f, 18f, 11.2f, 18f, 9f)
            curveTo(18f, 5.7f, 15.3f, 3f, 12f, 3f)
            close()
            moveTo(9.5f, 19f)
            lineTo(14.5f, 19f)
            moveTo(10.5f, 21f)
            lineTo(13.5f, 21f)
        }

    /** Upward trend — web `trendUp` (improving trend chip). */
    val TrendingUp: ImageVector =
        strokedGlyph("DriveScoreTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }
}
