// Locally-authored stroked vector glyphs for the TemperatureImpactPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/maps/pages/TemperatureImpactPage.tsx imports Thermometer,
// Snowflake, Sun, Lightbulb, TrendingUp, Activity; AlertCircle is supplied by the shared AlertBanner's own tone
// glyph). This mirrors the established A7 page precedent (LifetimeStatsPageIcons / IngestXRayPageIcons): glyphs the
// shared catalogs already carry are re-exported (Snowflake from the data-display catalog), and the remainder are
// authored locally as 24×24 stroked vectors and recoloured at render via the Icon `tint`, rather than editing the
// shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.maps.temperatureimpact

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
 * The glyph set this surface needs (web lucide icons). Snowflake is re-exported from the shared data-display
 * catalog so the page reads every icon from one source; the other five are authored locally.
 */
object TemperatureImpactGlyphs {
    /** Snowflake — web `Snowflake` (cold-weather tip). Reused from the shared data-display catalog. */
    val Snowflake: ImageVector = DataDisplayGlyphs.Snowflake

    /** Thermometer — web `Thermometer` (avg-efficiency + total-points cards, optimal-analysis header). */
    val Thermometer: ImageVector =
        strokedGlyph("TempThermometer") {
            moveTo(12f, 3f)
            lineTo(12f, 14.5f)
            moveTo(12f, 14.5f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 12f, y1 = 20.5f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 12f, y1 = 14.5f)
        }

    /** Sun — web `Sun` (worst-temp-range card + hot-weather tip). */
    val Sun: ImageVector =
        strokedGlyph("TempSun") {
            moveTo(12f, 8f)
            arcTo(4f, 4f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 16f)
            arcTo(4f, 4f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 8f)
            moveTo(12f, 2f)
            lineTo(12f, 4f)
            moveTo(12f, 20f)
            lineTo(12f, 22f)
            moveTo(2f, 12f)
            lineTo(4f, 12f)
            moveTo(20f, 12f)
            lineTo(22f, 12f)
            moveTo(4.9f, 4.9f)
            lineTo(6.3f, 6.3f)
            moveTo(17.7f, 17.7f)
            lineTo(19.1f, 19.1f)
            moveTo(4.9f, 19.1f)
            lineTo(6.3f, 17.7f)
            moveTo(17.7f, 6.3f)
            lineTo(19.1f, 4.9f)
        }

    /** Lightbulb — web `Lightbulb` (tips & recommendations header). */
    val Lightbulb: ImageVector =
        strokedGlyph("TempLightbulb") {
            moveTo(9f, 18f)
            lineTo(15f, 18f)
            moveTo(10f, 21f)
            lineTo(14f, 21f)
            moveTo(9f, 18f)
            curveTo(9f, 14.5f, 6f, 13f, 6f, 9.5f)
            arcTo(6f, 6f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 18f, y1 = 9.5f)
            curveTo(18f, 13f, 15f, 14.5f, 15f, 18f)
        }

    /** Up-trend arrow — web `TrendingUp` (best-temp-range card + optimal tip). */
    val TrendingUp: ImageVector =
        strokedGlyph("TempTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** Activity pulse — web `Activity` (the tips empty-state icon). */
    val Activity: ImageVector =
        strokedGlyph("TempActivity") {
            moveTo(3f, 12f)
            lineTo(8f, 12f)
            lineTo(11f, 4f)
            lineTo(15f, 20f)
            lineTo(18f, 12f)
            lineTo(21f, 12f)
        }
}
