// Line-style icons for the VehicleCard feature view, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` (`ExternalLink`, `Trash2`, `Lock`, `Shield`). The shared data-display
// set already ships `ExternalLink`, `Lock`, and `Shield`, so this file authors only the one the shared sets
// lack — `Trash2` — as a 24×24 stroked vector (the same hand-authored approach as `components/ui/TeslaGlyphs`
// and the sibling VehicleHero surface). It is monochrome and recolored at render time by the `Icon`
// composable's `tint`, so it tracks the active theme.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleCard) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecard

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The one lucide glyph the card needs that the shared data-display / ui sets do not provide. */
object VehicleCardGlyphs {
    /** lucide `Trash2` — the "Remove vehicle" action (lidded can with two inner strokes). */
    val Trash: ImageVector =
        cardStroked("VehicleCardTrash") {
            // Top rim line spanning the can.
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            // Lid handle (the small raised tab).
            moveTo(9f, 7f)
            lineTo(9f, 4.5f)
            curveTo(9f, 3.7f, 9.7f, 3f, 10.5f, 3f)
            lineTo(13.5f, 3f)
            curveTo(14.3f, 3f, 15f, 3.7f, 15f, 4.5f)
            lineTo(15f, 7f)
            // Can body — tapered sides closing at the rounded base.
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            curveTo(7f, 20.6f, 7.4f, 21f, 8f, 21f)
            lineTo(16f, 21f)
            curveTo(16.6f, 21f, 17f, 20.6f, 17f, 20f)
            lineTo(18f, 7f)
            // Two inner strokes.
            moveTo(10f, 11f)
            lineTo(10f, 17f)
            moveTo(14f, 11f)
            lineTo(14f, 17f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun cardStroked(
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
