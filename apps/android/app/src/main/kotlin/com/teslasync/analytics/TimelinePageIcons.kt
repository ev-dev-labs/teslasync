// Locally-authored stroked vector glyphs for the TimelinePage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/analytics/pages/TimelinePage.tsx imports Clock, ArrowRightLeft, Car,
// BatteryCharging, Moon, RefreshCw, AlertCircle, BarChart3). This mirrors the established LifetimeStatsPageIcons
// precedent: glyphs the shared catalogs already carry are re-exported from those catalogs (Car / Clock /
// BatteryCharging / Refresh), and the remainder (ArrowRightLeft / Moon / BarChart3) are authored locally as 24×24
// stroked vectors and recolored at render via the Icon `tint`, rather than editing the shared catalogs (out of scope
// here). AlertCircle is supplied by the shared AlertBanner's own tone glyph, so it is not authored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.timeline

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
 * The glyph set this surface needs (web lucide icons). The four glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other three are authored locally.
 */
object TimelineGlyphs {
    /** Vehicle — web `Car` (driving-time card). Reused from the shared nav catalog. */
    val Car: ImageVector = NavGlyphs.Car

    /** Clock — web `Clock` (state-distribution empty state). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Charging battery — web `BatteryCharging` (charging-time card). Reused from the shared data-display catalog. */
    val BatteryCharging: ImageVector = DataDisplayGlyphs.BatteryCharging

    /** Circular refresh — web `RefreshCw` (the header refresh affordance). Reused from the shared feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Two opposed horizontal arrows — web `ArrowRightLeft` (total-transitions card). */
    val ArrowRightLeft: ImageVector =
        strokedGlyph("TimelineArrowRightLeft") {
            moveTo(16f, 3f)
            lineTo(20f, 7f)
            lineTo(16f, 11f)
            moveTo(20f, 7f)
            lineTo(4f, 7f)
            moveTo(8f, 13f)
            lineTo(4f, 17f)
            lineTo(8f, 21f)
            moveTo(20f, 17f)
            lineTo(4f, 17f)
        }

    /** Crescent moon — web `Moon` (idle / sleep-time card). */
    val Moon: ImageVector =
        strokedGlyph("TimelineMoon") {
            moveTo(20f, 14.5f)
            arcTo(8.5f, 8.5f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 9.5f, y1 = 4f)
            arcTo(6.5f, 6.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 20f, y1 = 14.5f)
            close()
        }

    /** Three-bar column chart with axes — web `BarChart3` (daily-breakdown header). */
    val BarChart3: ImageVector =
        strokedGlyph("TimelineBarChart3") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(8f, 21f)
            lineTo(8f, 13f)
            moveTo(13f, 21f)
            lineTo(13f, 7f)
            moveTo(18f, 21f)
            lineTo(18f, 10f)
        }
}
