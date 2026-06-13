// Line-style icons for the VehicleHeader feature view, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` (`ArrowLeft` for the back affordance, `Power` for the Wake action). The
// shared ui set ships neither a left-arrow nor a power glyph, so — like the sibling VehicleHero surface, which
// authors the lucide glyphs the shared sets lack — this file hand-authors the two as 24×24 stroked vectors.
// Each is monochrome (drawn in opaque black) and recolored at render time by the `Icon` composable's `tint`, so
// they inherit `LocalContentColor` and every theme/state color automatically. Authoring them locally (rather
// than substituting a near-miss shared glyph) keeps the surface at true parity with the web icons.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleHeader) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleheader

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The two lucide glyphs the header needs that the shared ui set does not provide. */
object VehicleHeaderGlyphs {
    /** lucide `ArrowLeft` — the back affordance (a horizontal shaft with a left-pointing arrowhead). */
    val ArrowLeft: ImageVector =
        headerStroked("VehicleHeaderArrowLeft") {
            moveTo(19f, 12f)
            lineTo(5f, 12f)
            moveTo(12f, 5f)
            lineTo(5f, 12f)
            lineTo(12f, 19f)
        }

    /** lucide `Power` — the Wake action (a top vertical line through a nearly-closed ring open at the top). */
    val Power: ImageVector =
        headerStroked("VehicleHeaderPower") {
            moveTo(12f, 2f)
            lineTo(12f, 12f)
            moveTo(18.36f, 6.64f)
            arcToRelative(9f, 9f, 0f, true, true, -12.73f, 0f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun headerStroked(
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
