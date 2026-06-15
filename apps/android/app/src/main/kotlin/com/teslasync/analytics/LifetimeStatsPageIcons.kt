// Locally-authored stroked vector glyphs for the LifetimeStatsPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/analytics/pages/LifetimeStatsPage.tsx imports Car, Zap, DollarSign,
// Leaf, Globe, Moon, Clock, Award, Flame, TreePine, Home, Trophy, Gauge, BatteryCharging). This mirrors the
// established admin-page precedent (IngestXRayPageIcons): glyphs the shared catalogs already carry are re-exported
// from those catalogs (Car / Zap=Bolt / Clock / Gauge / BatteryCharging), and the remainder are authored locally as
// 24×24 stroked vectors and recolored at render via the Icon `tint`, rather than editing the shared catalogs (out of
// scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.lifetimestats

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
 * The glyph set this surface needs (web lucide icons). The five glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other nine are authored locally.
 */
object LifetimeStatsGlyphs {
    /** Vehicle — web `Car` (hero + total-drives + longest-drive). Reused from the shared nav catalog. */
    val Car: ImageVector = NavGlyphs.Car

    /** Lightning bolt — web `Zap` (total-energy). Reused from the shared data-display catalog. */
    val Zap: ImageVector = DataDisplayGlyphs.Bolt

    /** Clock — web `Clock` (activity summary). Reused from the shared data-display catalog. */
    val Clock: ImageVector = DataDisplayGlyphs.Clock

    /** Speedometer — web `Gauge` (total-distance + highest-speed). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Charging battery — web `BatteryCharging` (biggest-charge). Reused from the shared data-display catalog. */
    val BatteryCharging: ImageVector = DataDisplayGlyphs.BatteryCharging

    /** Dollar sign — web `DollarSign` (total-savings + savings comparison). */
    val DollarSign: ImageVector =
        strokedGlyph("LifetimeDollarSign") {
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

    /** Leaf — web `Leaf` (environmental impact). */
    val Leaf: ImageVector =
        strokedGlyph("LifetimeLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14.5f, 9.5f)
        }

    /** Globe — web `Globe` (fun-facts: around the Earth). */
    val Globe: ImageVector =
        strokedGlyph("LifetimeGlobe") {
            moveTo(12f, 3f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 21f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 3f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            moveTo(12f, 3f)
            arcTo(5f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 12f, y1 = 21f)
            arcTo(5f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 12f, y1 = 3f)
        }

    /** Crescent moon — web `Moon` (fun-facts: to the Moon). */
    val Moon: ImageVector =
        strokedGlyph("LifetimeMoon") {
            moveTo(20f, 14.5f)
            arcTo(8.5f, 8.5f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 9.5f, y1 = 4f)
            arcTo(6.5f, 6.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 20f, y1 = 14.5f)
            close()
        }

    /** Award medal — web `Award` (personal records). */
    val Award: ImageVector =
        strokedGlyph("LifetimeAward") {
            moveTo(12f, 4f)
            arcTo(4.5f, 4.5f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 13f)
            arcTo(4.5f, 4.5f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 12f, y1 = 4f)
            moveTo(9.7f, 12.5f)
            lineTo(8f, 21f)
            lineTo(12f, 18.5f)
            lineTo(16f, 21f)
            lineTo(14.3f, 12.5f)
        }

    /** Flame — web `Flame` (fun-facts header). */
    val Flame: ImageVector =
        strokedGlyph("LifetimeFlame") {
            moveTo(12f, 2.5f)
            curveTo(12f, 6.5f, 7f, 8.5f, 7f, 13.5f)
            arcTo(5f, 5f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 17f, y1 = 13.5f)
            curveTo(17f, 10.5f, 15f, 9.5f, 14.5f, 7.5f)
            curveTo(13f, 9.5f, 12.5f, 9.5f, 12f, 8.5f)
            close()
        }

    /** Pine tree — web `TreePine` (fun-facts: trees planted). */
    val TreePine: ImageVector =
        strokedGlyph("LifetimeTreePine") {
            moveTo(12f, 3f)
            lineTo(8f, 9f)
            lineTo(10f, 9f)
            lineTo(7f, 14f)
            lineTo(10.5f, 14f)
            lineTo(7f, 18f)
            lineTo(17f, 18f)
            lineTo(13.5f, 14f)
            lineTo(17f, 14f)
            lineTo(14f, 9f)
            lineTo(16f, 9f)
            close()
            moveTo(12f, 18f)
            lineTo(12f, 21f)
        }

    /** House — web `Home` (fun-facts: homes powered). */
    val Home: ImageVector =
        strokedGlyph("LifetimeHome") {
            moveTo(3f, 11f)
            lineTo(12f, 3f)
            lineTo(21f, 11f)
            moveTo(5f, 9.5f)
            lineTo(5f, 20f)
            lineTo(19f, 20f)
            lineTo(19f, 9.5f)
            moveTo(10f, 20f)
            lineTo(10f, 14f)
            lineTo(14f, 14f)
            lineTo(14f, 20f)
        }

    /** Trophy — web `Trophy` (achievements). */
    val Trophy: ImageVector =
        strokedGlyph("LifetimeTrophy") {
            moveTo(8f, 4f)
            lineTo(16f, 4f)
            lineTo(16f, 9f)
            curveTo(16f, 12f, 14f, 13.5f, 12f, 13.5f)
            curveTo(10f, 13.5f, 8f, 12f, 8f, 9f)
            close()
            moveTo(8f, 5.5f)
            curveTo(5f, 5.5f, 5f, 9f, 8f, 9f)
            moveTo(16f, 5.5f)
            curveTo(19f, 5.5f, 19f, 9f, 16f, 9f)
            moveTo(12f, 13.5f)
            lineTo(12f, 17f)
            moveTo(9f, 20f)
            lineTo(15f, 20f)
            lineTo(14f, 17f)
            lineTo(10f, 17f)
            close()
        }
}
