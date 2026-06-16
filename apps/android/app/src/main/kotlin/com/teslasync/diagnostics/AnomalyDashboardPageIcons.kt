// Locally-authored stroked vector glyphs for the AnomalyDashboardPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx imports Shield,
// AlertTriangle, Activity, Zap, Thermometer, Car, Battery, Wind, ChevronRight). This mirrors the established
// analytics-page precedent (StatisticsPageIcons): glyphs the shared catalogs already carry are re-exported from those
// catalogs (Shield / AlertTriangle / Battery from the data-display catalog, Zap=Bolt, Car from the nav catalog,
// ChevronRight from the ui catalog), and the remainder (Activity / Thermometer / Wind) are authored locally as 24×24
// stroked vectors and recolored at render via the Icon `tint`, rather than editing the shared catalogs (out of scope
// here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/diagnostics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.diagnostics.anomalydashboard

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
 * The glyph set this surface needs (web lucide icons). The six glyphs the shared catalogs already carry are re-exported
 * so the page reads every icon from one source; the other three are authored locally.
 */
object AnomalyDashboardGlyphs {
    /** Shield — web `Shield` (24h-anomalies stat, health-category fallback, the no-anomalies empty-state). */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Warning triangle — web `AlertTriangle` (7d-anomalies stat + the timeline header). */
    val AlertTriangle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Battery — web `Battery` (the `battery` health category). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Lightning bolt — web `Zap` (the `motors` health category). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Vehicle — web `Car` (the `tires` health category). Reused from the shared nav catalog. */
    val Car: ImageVector = NavGlyphs.Car

    /** Chevron — web `ChevronRight` (the timeline-row affordance). Reused from the shared ui catalog. */
    val ChevronRight: ImageVector = TeslaGlyphs.ChevronRight

    /** Pulse — web `Activity` (signals-monitored stat + the `charging` health category). */
    val Activity: ImageVector =
        strokedGlyph("AnomalyActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** Thermometer — web `Thermometer` (the health-categories count stat). */
    val Thermometer: ImageVector =
        strokedGlyph("AnomalyThermometer") {
            moveTo(12f, 3f)
            curveTo(10.6f, 3f, 9.5f, 4.1f, 9.5f, 5.5f)
            lineTo(9.5f, 13.5f)
            curveTo(8.3f, 14.3f, 7.5f, 15.7f, 7.5f, 17.3f)
            curveTo(7.5f, 19.8f, 9.5f, 21.8f, 12f, 21.8f)
            curveTo(14.5f, 21.8f, 16.5f, 19.8f, 16.5f, 17.3f)
            curveTo(16.5f, 15.7f, 15.7f, 14.3f, 14.5f, 13.5f)
            lineTo(14.5f, 5.5f)
            curveTo(14.5f, 4.1f, 13.4f, 3f, 12f, 3f)
            close()
        }

    /** Wind — web `Wind` (the `hvac` health category). */
    val Wind: ImageVector =
        strokedGlyph("AnomalyWind") {
            moveTo(3f, 8f)
            lineTo(11f, 8f)
            curveTo(12.7f, 8f, 14f, 6.7f, 14f, 5f)
            curveTo(14f, 3.3f, 12.7f, 2f, 11f, 2f)
            curveTo(9.7f, 2f, 8.6f, 2.8f, 8.2f, 4f)
            moveTo(3f, 12f)
            lineTo(17f, 12f)
            curveTo(18.9f, 12f, 20.5f, 10.4f, 20.5f, 8.5f)
            curveTo(20.5f, 6.6f, 18.9f, 5f, 17f, 5f)
            moveTo(3f, 16f)
            lineTo(13f, 16f)
            curveTo(14.7f, 16f, 16f, 17.3f, 16f, 19f)
            curveTo(16f, 20.7f, 14.7f, 22f, 13f, 22f)
            curveTo(11.7f, 22f, 10.6f, 21.2f, 10.2f, 20f)
        }
}
