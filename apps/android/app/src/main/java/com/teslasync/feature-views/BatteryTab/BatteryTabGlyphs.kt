// Line-style icons for the Battery analytics feature view, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` (`Heart`, `Battery`, `TrendingUp`, `MapPin`, `Activity`). The
// data-display layer already ships `Battery` and `MapPin`, so this file authors only the three the layer
// lacks — `Heart`, `TrendingUp`, `Activity` — as 24×24 stroked vectors (the same hand-authored approach as
// `components/ui/TeslaGlyphs` and the SpeedProfile surface). Each is monochrome and recolored at render
// time by the `Icon` composable's `tint`, so they track the active theme.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryTab) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterytab

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The three lucide glyphs the metric cards need that the shared data-display set does not provide. */
object BatteryTabGlyphs {
    /** lucide `Heart` — the Health Score card accent. */
    val Heart: ImageVector =
        batteryStroked("BatteryTabHeart") {
            moveTo(12f, 21f)
            lineTo(10.55f, 19.7f)
            curveTo(5.4f, 15.1f, 2f, 12.1f, 2f, 8.5f)
            curveTo(2f, 5.4f, 4.4f, 3f, 7.5f, 3f)
            curveTo(9.2f, 3f, 10.9f, 3.8f, 12f, 5.1f)
            curveTo(13.1f, 3.8f, 14.8f, 3f, 16.5f, 3f)
            curveTo(19.6f, 3f, 22f, 5.4f, 22f, 8.5f)
            curveTo(22f, 12.1f, 18.6f, 15.1f, 13.45f, 19.7f)
            close()
        }

    /** lucide `TrendingUp` — the Degradation card accent. */
    val TrendingUp: ImageVector =
        batteryStroked("BatteryTabTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** lucide `Activity` — the Cycles card accent (the cardiac-pulse line). */
    val Activity: ImageVector =
        batteryStroked("BatteryTabActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun batteryStroked(
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
