// Line-style icons for the Vehicle Gauges feature view, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` (`Lock`, `Unlock`, `Shield`, `Wind`, `Cpu`). The shared data-display
// set already ships `Lock` and `Shield`, so this file authors only the three the shared sets lack — as 24×24
// stroked vectors (the same hand-authored approach as the sibling VehicleHero surface). Each is monochrome and
// recolored at render time by the `Icon` composable's `tint`, so they track the active theme.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleGauges) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclegauges

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The three lucide glyphs the gauges panel needs that the shared data-display set does not provide. */
object VehicleGaugesGlyphs {
    /** lucide `Unlock` — the unlocked status chip (open-shackle padlock). */
    val Unlock: ImageVector =
        gaugeStroked("VehicleGaugesUnlock") {
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            lineTo(19f, 20f)
            lineTo(5f, 20f)
            close()
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            moveTo(8f, 7f)
            curveTo(8f, 4.8f, 9.8f, 3f, 12f, 3f)
            curveTo(13.7f, 3f, 15.1f, 4f, 15.7f, 5.5f)
        }

    /** lucide `Wind` — the climate chip (three curling air currents). */
    val Wind: ImageVector =
        gaugeStroked("VehicleGaugesWind") {
            moveTo(2f, 8f)
            lineTo(11f, 8f)
            curveTo(13f, 8f, 13f, 5f, 11f, 5f)
            curveTo(10f, 5f, 9.6f, 5.8f, 9.8f, 6.5f)
            moveTo(2f, 12f)
            lineTo(17.5f, 12f)
            curveTo(19.5f, 12f, 19.5f, 8.5f, 17.5f, 8.5f)
            curveTo(16.3f, 8.5f, 15.9f, 9.4f, 16.1f, 10.2f)
            moveTo(2f, 16f)
            lineTo(13f, 16f)
            curveTo(15f, 16f, 15f, 19f, 13f, 19f)
            curveTo(12f, 19f, 11.6f, 18.2f, 11.8f, 17.5f)
        }

    /** lucide `Cpu` — the firmware chip (a chip body with eight pins). */
    val Cpu: ImageVector =
        gaugeStroked("VehicleGaugesCpu") {
            moveTo(5f, 5f)
            lineTo(19f, 5f)
            lineTo(19f, 19f)
            lineTo(5f, 19f)
            close()
            moveTo(9f, 9f)
            lineTo(15f, 9f)
            lineTo(15f, 15f)
            lineTo(9f, 15f)
            close()
            moveTo(9f, 5f)
            lineTo(9f, 2f)
            moveTo(15f, 5f)
            lineTo(15f, 2f)
            moveTo(9f, 19f)
            lineTo(9f, 22f)
            moveTo(15f, 19f)
            lineTo(15f, 22f)
            moveTo(5f, 9f)
            lineTo(2f, 9f)
            moveTo(5f, 15f)
            lineTo(2f, 15f)
            moveTo(19f, 9f)
            lineTo(22f, 9f)
            moveTo(19f, 15f)
            lineTo(22f, 15f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun gaugeStroked(
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
