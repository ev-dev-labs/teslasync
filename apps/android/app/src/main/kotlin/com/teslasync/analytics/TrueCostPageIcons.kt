// Locally-authored stroked vector glyphs for the TrueCostPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/analytics/pages/TrueCostPage.tsx imports DollarSign, Fuel, Zap, TrendingUp,
// Leaf). This mirrors the established LifetimeStatsPageIcons precedent: the one glyph the shared catalogs already
// carry is re-exported from that catalog (Zap=Bolt), and the remainder are authored locally as 24×24 stroked vectors
// and recolored at render via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.truecost

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
 * The glyph set this surface needs (web lucide icons). The lightning bolt the shared data-display catalog already
 * carries is re-exported so the page reads it from one source; the other four are authored locally.
 */
object TrueCostGlyphs {
    /** Lightning bolt — web `Zap` (Total EV Cost hero). Reused from the shared data-display catalog. */
    val Zap: ImageVector = DataDisplayGlyphs.Bolt

    /** Dollar sign — web `DollarSign` (Savings Breakdown header + the no-data empty state). */
    val DollarSign: ImageVector =
        strokedGlyph("TrueCostDollarSign") {
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

    /** Fuel pump — web `Fuel` (Equiv. Gas Cost hero). */
    val Fuel: ImageVector =
        strokedGlyph("TrueCostFuel") {
            moveTo(3f, 22f)
            lineTo(15f, 22f)
            moveTo(4f, 22f)
            lineTo(4f, 5f)
            curveTo(4f, 3.3f, 5.3f, 2f, 7f, 2f)
            lineTo(11f, 2f)
            curveTo(12.7f, 2f, 14f, 3.3f, 14f, 5f)
            lineTo(14f, 22f)
            moveTo(4f, 9.5f)
            lineTo(14f, 9.5f)
            moveTo(14f, 13f)
            lineTo(16f, 13f)
            curveTo(17.1f, 13f, 18f, 13.9f, 18f, 15f)
            lineTo(18f, 17f)
            curveTo(18f, 18.1f, 18.9f, 19f, 20f, 19f)
            curveTo(21.1f, 19f, 22f, 18.1f, 22f, 17f)
            lineTo(22f, 9.8f)
            curveTo(22f, 9.3f, 21.8f, 8.8f, 21.4f, 8.4f)
            lineTo(18f, 5f)
        }

    /** Trending-up arrow — web `TrendingUp` (Monthly Savings hero). */
    val TrendingUp: ImageVector =
        strokedGlyph("TrueCostTrendingUp") {
            moveTo(2f, 17f)
            lineTo(8.5f, 10.5f)
            lineTo(13.5f, 15.5f)
            lineTo(22f, 7f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** Leaf — web `Leaf` (Total Savings hero). */
    val Leaf: ImageVector =
        strokedGlyph("TrueCostLeaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14.5f, 9.5f)
        }
}
