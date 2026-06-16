// Locally-authored stroked vector glyphs for the EnergyPage battery surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/battery/pages/EnergyPage.tsx imports Zap, Leaf, Fuel, Sun, Moon, ArrowRight,
// Activity). This mirrors the established analytics-page precedent (StatisticsPageIcons): glyphs the shared catalogs
// already carry are re-exported from those catalogs (Zap=Bolt / ArrowRight / Gauge / MapPin), and the remainder (Leaf /
// Fuel / Sun / Moon / Activity / DollarSign) are authored locally as 24×24 stroked vectors and recolored at render via
// the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.energy

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
 * The glyph set this surface needs (web lucide icons). The four glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other six are authored locally.
 */
object EnergyGlyphs {
    /** Lightning bolt — web `Zap` (energy hero + lifetime + sessions). Reused from the shared data-display catalog. */
    val Bolt: ImageVector = DataDisplayGlyphs.Bolt

    /** Right arrow — web `ArrowRight` (cost-comparison EV→gas). Reused from the shared data-display catalog. */
    val ArrowRight: ImageVector = DataDisplayGlyphs.ArrowRight

    /** Speedometer — web `Gauge`-adjacent (efficiency context). Reused from the shared data-display catalog. */
    val Gauge: ImageVector = DataDisplayGlyphs.Gauge

    /** Map pin — distance context. Reused from the shared data-display catalog. */
    val MapPin: ImageVector = DataDisplayGlyphs.MapPin

    /** Leaf — web `Leaf` (CO₂ saved + projected-annual card). */
    val Leaf: ImageVector =
        strokedGlyph("EnergyLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14.5f, 9.5f)
        }

    /** Fuel pump — web `Fuel` (the period-total cost-comparison card). */
    val Fuel: ImageVector =
        strokedGlyph("EnergyFuel") {
            moveTo(3f, 22f)
            lineTo(15f, 22f)
            moveTo(5f, 22f)
            lineTo(5f, 5f)
            curveTo(5f, 3.9f, 5.9f, 3f, 7f, 3f)
            lineTo(11f, 3f)
            curveTo(12.1f, 3f, 13f, 3.9f, 13f, 5f)
            lineTo(13f, 22f)
            moveTo(5f, 12f)
            lineTo(13f, 12f)
            moveTo(13f, 8f)
            lineTo(16f, 8f)
            curveTo(17.1f, 8f, 18f, 8.9f, 18f, 10f)
            lineTo(18f, 15f)
            curveTo(18f, 15.8f, 18.7f, 16.5f, 19.5f, 16.5f)
            curveTo(20.3f, 16.5f, 21f, 15.8f, 21f, 15f)
            lineTo(21f, 9f)
            lineTo(18f, 6f)
        }

    /** Sun — web `Sun` (solar-optimal charging tip). */
    val Sun: ImageVector =
        strokedGlyph("EnergySun") {
            moveTo(12f, 8f)
            curveTo(14.2f, 8f, 16f, 9.8f, 16f, 12f)
            curveTo(16f, 14.2f, 14.2f, 16f, 12f, 16f)
            curveTo(9.8f, 16f, 8f, 14.2f, 8f, 12f)
            curveTo(8f, 9.8f, 9.8f, 8f, 12f, 8f)
            close()
            moveTo(12f, 1f)
            lineTo(12f, 3f)
            moveTo(12f, 21f)
            lineTo(12f, 23f)
            moveTo(4.2f, 4.2f)
            lineTo(5.6f, 5.6f)
            moveTo(18.4f, 18.4f)
            lineTo(19.8f, 19.8f)
            moveTo(1f, 12f)
            lineTo(3f, 12f)
            moveTo(21f, 12f)
            lineTo(23f, 12f)
            moveTo(4.2f, 19.8f)
            lineTo(5.6f, 18.4f)
            moveTo(18.4f, 5.6f)
            lineTo(19.8f, 4.2f)
        }

    /** Crescent moon — web `Moon` (off-peak charging tip). */
    val Moon: ImageVector =
        strokedGlyph("EnergyMoon") {
            moveTo(20f, 14.5f)
            curveTo(18.7f, 15.4f, 17.1f, 16f, 15.3f, 16f)
            curveTo(10.7f, 16f, 7f, 12.3f, 7f, 7.7f)
            curveTo(7f, 5.9f, 7.6f, 4.3f, 8.5f, 3f)
            curveTo(5.2f, 4.3f, 3f, 7.4f, 3f, 11f)
            curveTo(3f, 15.9f, 7.1f, 20f, 12f, 20f)
            curveTo(15.6f, 20f, 18.7f, 17.8f, 20f, 14.5f)
            close()
        }

    /** Activity pulse — web `Activity` (the chart/table empty-state icon). */
    val Activity: ImageVector =
        strokedGlyph("EnergyActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** Dollar sign — cost-context glyph (web cost cards use `Currency`, the panels use a cost affordance). */
    val DollarSign: ImageVector =
        strokedGlyph("EnergyDollarSign") {
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
}
