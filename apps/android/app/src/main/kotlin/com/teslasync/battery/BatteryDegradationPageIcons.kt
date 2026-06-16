// Locally-authored stroked vector glyphs for the BatteryDegradationPage surface — the native counterparts of the
// web lucide icons the page renders (web/src/features/battery/pages/BatteryDegradationPage.tsx imports Battery,
// TrendingDown, Zap, Thermometer, Shield, Activity, Calendar, AlertTriangle). This mirrors the established
// analytics-page precedent (StatisticsPageIcons): glyphs the shared catalogs already carry are re-exported from
// those catalogs (Battery / TrendingDown / Shield / AlertTriangle / Gauge / Clock = DataDisplayGlyphs, Bolt=Zap =
// DataDisplayGlyphs, Refresh = FeedbackGlyphs, Calendar = FormsGlyphs), and the remainder (Thermometer / Activity
// / TrendingUp) are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`, rather
// than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.degradation

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
 * The glyph set this surface needs (web lucide icons). The glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other three are authored locally.
 */
object BatteryDegradationGlyphs {
    /** Battery — web `Battery` (SoH metric + gauge empty-state). Reused from the shared data-display catalog. */
    val Battery: ImageVector = DataDisplayGlyphs.Battery

    /** Downward trend — web `TrendingDown` (degradation-rate metric). Reused from the shared data-display catalog. */
    val TrendingDown: ImageVector = DataDisplayGlyphs.TrendingDown

    /** Lightning bolt — web `Zap` (capacity + recommendations + charging impact). Reused from the data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Shield — web `Shield` (risk factors + health factors). Reused from the shared data-display catalog. */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Warning triangle — web `AlertTriangle` (need-more + recommendations). Reused from the data-display catalog. */
    val AlertTriangle: ImageVector = DataDisplayGlyphs.AlertTriangle

    /** Speedometer — web `Gauge` reuse for cycle-count risk. Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Clock — web `Calendar`/age affordance reuse. Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Refresh cycle — web `Activity`/cycles reuse for the cycle stat. Reused from the shared feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Calendar — web `Calendar` (battery-age metric). Reused from the shared forms catalog. */
    val Calendar: ImageVector = FormsGlyphs.Calendar

    /** Thermometer — web `Thermometer` (temperature exposure + charging impact). */
    val Thermometer: ImageVector =
        strokedGlyph("BatteryDegradationThermometer") {
            moveTo(14f, 14.76f)
            lineTo(14f, 5f)
            curveTo(14f, 3.9f, 13.1f, 3f, 12f, 3f)
            curveTo(10.9f, 3f, 10f, 3.9f, 10f, 5f)
            lineTo(10f, 14.76f)
            curveTo(8.8f, 15.46f, 8f, 16.83f, 8f, 18.4f)
            curveTo(8f, 20.6f, 9.79f, 22.4f, 12f, 22.4f)
            curveTo(14.21f, 22.4f, 16f, 20.6f, 16f, 18.4f)
            curveTo(16f, 16.83f, 15.2f, 15.46f, 14f, 14.76f)
            close()
        }

    /** Activity pulse — web `Activity` (cycle-count risk + degradation history). */
    val Activity: ImageVector =
        strokedGlyph("BatteryDegradationActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** Upward trend — web `TrendingUp` (degradation rate within the prediction card). */
    val TrendingUp: ImageVector =
        strokedGlyph("BatteryDegradationTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }
}
