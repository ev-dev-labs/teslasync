// Locally-authored / re-exported stroked vector glyphs for the MaintenancePage surface — the native counterparts of
// the web lucide icons the page renders (web/src/features/vehicle-systems/pages/MaintenancePage.tsx imports Wrench,
// AlertTriangle, CheckCircle, Clock, ListChecks, CalendarPlus, Filter, ArrowUpDown, Gauge, Tag, DollarSign,
// TrendingUp, AlertCircle). This mirrors the established A7 precedent (BatteryHealthPageIcons / AnalyticsPageIcons):
// glyphs the shared catalogs already carry are re-exported from those catalogs (Wrench, AlertTriangle, CheckCircle,
// Clock, Gauge, Tag, Filter, AlertCircle), and the remainder (ListChecks, CalendarPlus, ArrowUpDown, DollarSign,
// TrendingUp) are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather than
// editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.maintenance

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
import io.teslasync.android.components.forms.FormsGlyphs

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
 * the page reads every icon from one source; the other five are authored locally.
 */
object MaintenanceGlyphs {
    /** Wrench — web `Wrench` (item cards + projection rows). Reused from the shared feedback catalog. */
    val Wrench: ImageVector = FeedbackGlyphs.Wrench

    /** Warning triangle — web `AlertTriangle` (overdue summary card). Reused from the shared data-display catalog. */
    val AlertTriangle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Check-in-circle — web `CheckCircle` (completed summary card). Reused from the shared data-display catalog. */
    val CheckCircle: ImageVector = DataDisplayGlyphs.CheckCircle

    /** Clock — web `Clock` (due-soon card + item last-service). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Dial gauge — web `Gauge` (item current mileage). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Tag — web `Tag` (category chip). Reused from the shared forms catalog. */
    val Tag: ImageVector = FormsGlyphs.Tag

    /** Funnel — web `Filter` (category toolbar control). Reused from the shared forms catalog. */
    val Filter: ImageVector = FormsGlyphs.Filter

    /** Warning circle — web `AlertCircle` (error banner). Reused from the shared data-display catalog. */
    val AlertCircle: ImageVector = DataDisplayGlyphs.Info

    /** Two checked rows over two lines — web `ListChecks` (total-items summary card). */
    val ListChecks: ImageVector =
        strokedGlyph("MaintenanceListChecks") {
            moveTo(3.5f, 6f); lineTo(5f, 7.5f); lineTo(8f, 4.5f)
            moveTo(3.5f, 13f); lineTo(5f, 14.5f); lineTo(8f, 11.5f)
            moveTo(12f, 6f); lineTo(20f, 6f)
            moveTo(12f, 13f); lineTo(20f, 13f)
            moveTo(12f, 19f); lineTo(20f, 19f)
        }

    /** A calendar with a plus — web `CalendarPlus` (schedule-maintenance action). */
    val CalendarPlus: ImageVector =
        strokedGlyph("MaintenanceCalendarPlus") {
            moveTo(5f, 5f); lineTo(19f, 5f); lineTo(19f, 19f); lineTo(5f, 19f); close()
            moveTo(5f, 9f); lineTo(19f, 9f)
            moveTo(8f, 3f); lineTo(8f, 6f)
            moveTo(16f, 3f); lineTo(16f, 6f)
            moveTo(12f, 12f); lineTo(12f, 16f)
            moveTo(10f, 14f); lineTo(14f, 14f)
        }

    /** Two opposed vertical arrows — web `ArrowUpDown` (sort toolbar control). */
    val ArrowUpDown: ImageVector =
        strokedGlyph("MaintenanceArrowUpDown") {
            moveTo(7f, 4f); lineTo(7f, 20f)
            moveTo(4f, 7f); lineTo(7f, 4f); lineTo(10f, 7f)
            moveTo(17f, 20f); lineTo(17f, 4f)
            moveTo(14f, 17f); lineTo(17f, 20f); lineTo(20f, 17f)
        }

    /** A dollar sign — web `DollarSign` (cost-summary panel header). */
    val DollarSign: ImageVector =
        strokedGlyph("MaintenanceDollarSign") {
            moveTo(12f, 3f); lineTo(12f, 21f)
            moveTo(16f, 7.5f); curveTo(15f, 6.3f, 13.5f, 5.7f, 12f, 5.7f)
            curveTo(9.8f, 5.7f, 8f, 7f, 8f, 9f); curveTo(8f, 11f, 9.8f, 11.8f, 12f, 12f)
            curveTo(14.2f, 12.2f, 16f, 13f, 16f, 15f); curveTo(16f, 17f, 14.2f, 18.3f, 12f, 18.3f)
            curveTo(10.5f, 18.3f, 9f, 17.7f, 8f, 16.5f)
        }

    /** An up-and-to-the-right trend arrow — web `TrendingUp` (service-projections panel header). */
    val TrendingUp: ImageVector =
        strokedGlyph("MaintenanceTrendingUp") {
            moveTo(3f, 17f); lineTo(9f, 11f); lineTo(13f, 15f); lineTo(21f, 7f)
            moveTo(15f, 7f); lineTo(21f, 7f); lineTo(21f, 13f)
        }
}
