// Self-contained line-style icon set for the TourLauncher surface, drawn as Material [ImageVector]s.
//
// The web component uses four `lucide-react` glyphs: `Check` + `X` (already in the shared TeslaGlyphs set, so
// reused there) and `PlayCircle`, `RotateCcw`, `Sparkles` (authored here). Android ships no lucide-equivalent
// set without the frozen `material-icons-extended` artifact, so — exactly as the shared glyph sets and the
// sibling AutopilotSectionGlyphs do — each is a 24×24 stroked vector reproducing the lucide outline. They are
// monochrome (drawn in opaque black) and recolored at render time by the `Icon` composable's tint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/misc-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.tourlauncher

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the TourLauncher rows + footer render (Check / X come from TeslaGlyphs). */
internal object TourLauncherGlyphs {
    /** lucide `play-circle` — the not-yet-taken tour glyph: a play triangle inside a ring. */
    val PlayCircle: ImageVector =
        stroked("PlayCircle") {
            // Ring (r = 10, centered at 12,12) drawn as two half-arcs.
            moveTo(2f, 12f)
            arcToRelative(10f, 10f, 0f, isMoreThanHalf = true, isPositiveArc = true, 20f, 0f)
            arcToRelative(10f, 10f, 0f, isMoreThanHalf = true, isPositiveArc = true, -20f, 0f)
            // Play triangle.
            moveTo(10f, 8f)
            lineTo(16f, 12f)
            lineTo(10f, 16f)
            close()
        }

    /** lucide `rotate-ccw` — the "Reset all tours" glyph: a counter-clockwise refresh arrow. */
    val RotateCcw: ImageVector =
        stroked("RotateCcw") {
            moveTo(3f, 12f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = false, 9f, -9f)
            arcToRelative(9.75f, 9.75f, 0f, isMoreThanHalf = false, isPositiveArc = false, -6.74f, 2.74f)
            lineTo(3f, 8f)
            moveTo(3f, 3f)
            verticalLineToRelative(5f)
            horizontalLineToRelative(5f)
        }

    /** lucide `sparkles` — the "Recommended for this page" chip glyph: a four-point star with a small accent. */
    val Sparkles: ImageVector =
        stroked("Sparkles") {
            // Primary four-point sparkle.
            moveTo(10f, 3f)
            lineTo(11.6f, 9.4f)
            lineTo(18f, 11f)
            lineTo(11.6f, 12.6f)
            lineTo(10f, 19f)
            lineTo(8.4f, 12.6f)
            lineTo(2f, 11f)
            lineTo(8.4f, 9.4f)
            close()
            // Small accent sparkle, top-right.
            moveTo(19f, 14f)
            lineTo(19.7f, 16.3f)
            lineTo(22f, 17f)
            lineTo(19.7f, 17.7f)
            lineTo(19f, 20f)
            lineTo(18.3f, 17.7f)
            lineTo(16f, 17f)
            lineTo(18.3f, 16.3f)
            close()
        }

    private fun stroked(
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
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}
