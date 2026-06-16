// Locally-authored stroked vector glyphs for the RouteEfficiencyPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/driving/pages/RouteEfficiencyPage.tsx imports MapPin, ArrowRight,
// TrendingUp, Activity). This mirrors the established analytics-page precedent (StatisticsPageIcons): the glyph the
// shared catalogs already carry is re-exported (MapPin from the data-display catalog), and the remainder (ArrowRight /
// TrendingUp / Activity) are authored locally as 24×24 stroked vectors and recolored at render via the Icon `tint`,
// rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.routeefficiency

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

/**
 * The glyph set this surface needs (web lucide icons). The map-pin glyph the shared catalog already carries is
 * re-exported so the page reads it from one source; the other three are authored locally.
 */
object RouteEfficiencyGlyphs {
    /** Map pin — web `MapPin` (per-route card header). Reused from the shared data-display catalog. */
    val MapPin: ImageVector = DataDisplayGlyphs.MapPin

    /** Right arrow — web `ArrowRight` (the start -> end route separator). */
    val ArrowRight: ImageVector =
        strokedGlyph("RouteEfficiencyArrowRight") {
            moveTo(5f, 12f)
            lineTo(19f, 12f)
            moveTo(13f, 6f)
            lineTo(19f, 12f)
            lineTo(13f, 18f)
        }

    /** Upward trend — web `TrendingUp` (the Route Metrics panel heading). */
    val TrendingUp: ImageVector =
        strokedGlyph("RouteEfficiencyTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Pulse line — web `Activity` (the empty-state icon in the Route Metrics panel). */
    val Activity: ImageVector =
        strokedGlyph("RouteEfficiencyActivity") {
            moveTo(2f, 12f)
            lineTo(6f, 12f)
            lineTo(9f, 3f)
            lineTo(15f, 21f)
            lineTo(18f, 12f)
            lineTo(22f, 12f)
        }
}
