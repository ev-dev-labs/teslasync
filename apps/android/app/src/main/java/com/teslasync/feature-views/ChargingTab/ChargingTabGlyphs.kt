// Locally-authored 24×24 stroked icons for the ChargingTab feature view — the Android stand-ins for the
// web component's `lucide-react` glyphs (Plug, Zap, DollarSign, Gauge, Timer, TrendingUp). Android ships
// no lucide equivalent, so the surface authors its own monochrome [ImageVector]s (recolored at render
// time by each `MetricCard` accent) — the same approach the sibling SecurityStatistics / UuidGenerator
// surfaces use. Kept self-contained to this surface so the glyphs never couple to another icon set.
//
// Each glyph is decorative — the localized `MetricCard` label carries the meaning — so every call site
// renders it with a `null` content description (the `MetricCard` default), keeping it out of the
// TalkBack reading order rather than announcing a redundant icon name.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargingTab) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingtab

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The six monochrome line glyphs the summary tiles render, one per [ChargingMetric]. Authored as 24×24
 * round-capped stroked vectors so each inherits the Material 3 content color (the `MetricCard` accent)
 * in every theme — light, dark, and high-contrast.
 */
object ChargingTabGlyphs {
    /** lucide `plug` — a two-pronged plug body over a short cord (the Sessions tile). */
    val Plug: ImageVector =
        chargingVector("ChargingTabPlug") {
            moveTo(6f, 7f)
            horizontalLineTo(18f)
            verticalLineTo(11f)
            curveTo(18f, 14.31f, 15.31f, 17f, 12f, 17f)
            curveTo(8.69f, 17f, 6f, 14.31f, 6f, 11f)
            close()
            moveTo(9f, 2f)
            verticalLineTo(7f)
            moveTo(15f, 2f)
            verticalLineTo(7f)
            moveTo(12f, 17f)
            verticalLineTo(22f)
        }

    /** lucide `zap` — a lightning bolt (the Total Energy tile). */
    val Zap: ImageVector =
        chargingVector("ChargingTabZap") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(20f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `dollar-sign` — a vertical bar threaded through an S (the Total Cost tile). */
    val DollarSign: ImageVector =
        chargingVector("ChargingTabDollarSign") {
            moveTo(12f, 2f)
            verticalLineTo(22f)
            moveTo(17f, 6f)
            horizontalLineTo(9.5f)
            arcToRelative(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, dx1 = 0f, dy1 = 7f)
            horizontalLineToRelative(5f)
            arcToRelative(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, dx1 = 0f, dy1 = 7f)
            horizontalLineTo(6f)
        }

    /** lucide `gauge` — a dial dome with a pointing needle (the Avg Power tile). */
    val Gauge: ImageVector =
        chargingVector("ChargingTabGauge") {
            moveTo(3.8f, 17f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, dx1 = 16.4f, dy1 = 0f)
            moveTo(12f, 15f)
            lineTo(15.5f, 10f)
        }

    /** lucide `timer` — a stopwatch with a top cap and a hand (the Avg Duration tile). */
    val Timer: ImageVector =
        chargingVector("ChargingTabTimer") {
            moveTo(10f, 2f)
            horizontalLineTo(14f)
            moveTo(4f, 14f)
            arcToRelative(8f, 8f, 0f, isMoreThanHalf = true, isPositiveArc = true, dx1 = 16f, dy1 = 0f)
            arcToRelative(8f, 8f, 0f, isMoreThanHalf = true, isPositiveArc = true, dx1 = -16f, dy1 = 0f)
            moveTo(12f, 14f)
            lineTo(15f, 11f)
        }

    /** lucide `trending-up` — a rising zig-zag with a corner arrow (the Charge Efficiency tile). */
    val TrendingUp: ImageVector =
        chargingVector("ChargingTabTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            horizontalLineTo(22f)
            verticalLineTo(13f)
        }
}

/**
 * Builds a 24×24 round-capped, round-joined stroked [ImageVector] from a [PathBuilder] block — the one
 * authoring helper every glyph in this surface shares. The stroke is solid black so the rendering
 * `Icon`'s `tint` (the tile accent) fully recolors it in every theme.
 */
private fun chargingVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
