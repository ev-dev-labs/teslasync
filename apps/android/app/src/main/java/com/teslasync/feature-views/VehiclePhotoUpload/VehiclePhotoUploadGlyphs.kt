// Line-style icon for the VehiclePhotoUpload feature view, drawn as a Material [ImageVector].
//
// The web component renders no icon (its drop-zone is plain text), but the native surface uses a single
// image cue in the empty drop-zone so the affordance reads as "drop an image here" at a glance — the
// Android-idiomatic equivalent of the web's dashed-box image cue. The shared data-display / ui / feedback glyph
// sets ship no image/photo mark, so this file authors the one lucide `Image` glyph the surface needs as a 24×24
// stroked vector (the same hand-authored approach as `components/ui/TeslaGlyphs` and the sibling VehicleHero
// surface). It is monochrome and recolored at render time by the `Icon` composable's `tint`, so it tracks the
// active theme.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehiclePhotoUpload) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclephotoupload

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The single lucide glyph the photo drop-zone needs that the shared sets do not provide. */
object VehiclePhotoUploadGlyphs {
    /** lucide `Image` — a framed picture with a sun + mountain, the empty drop-zone cue. */
    val Image: ImageVector =
        photoStroked("VehiclePhotoUploadImage") {
            // Rounded frame.
            moveTo(5f, 3f)
            lineTo(19f, 3f)
            curveTo(20.1f, 3f, 21f, 3.9f, 21f, 5f)
            lineTo(21f, 19f)
            curveTo(21f, 20.1f, 20.1f, 21f, 19f, 21f)
            lineTo(5f, 21f)
            curveTo(3.9f, 21f, 3f, 20.1f, 3f, 19f)
            lineTo(3f, 5f)
            curveTo(3f, 3.9f, 3.9f, 3f, 5f, 3f)
            close()
            // Sun.
            moveTo(10f, 8.5f)
            curveTo(10f, 9.33f, 9.33f, 10f, 8.5f, 10f)
            curveTo(7.67f, 10f, 7f, 9.33f, 7f, 8.5f)
            curveTo(7f, 7.67f, 7.67f, 7f, 8.5f, 7f)
            curveTo(9.33f, 7f, 10f, 7.67f, 10f, 8.5f)
            close()
            // Mountain.
            moveTo(21f, 15f)
            lineTo(16f, 10f)
            lineTo(5f, 21f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun photoStroked(
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
