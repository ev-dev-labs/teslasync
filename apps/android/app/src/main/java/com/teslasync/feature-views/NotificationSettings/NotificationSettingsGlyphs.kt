// Locally-authored 24×24 stroked icons for the NotificationSettings surface, drawn as Material
// [ImageVector]s. The web component (web/src/features/settings/components/NotificationSettings.tsx) uses
// three `lucide-react` glyphs: `Bell` (the browser-notifications + section IconBox and the Enable button),
// `Volume2` (the notification-sounds IconBox) and `Play` (each channel's Test button). Android ships no
// lucide equivalent and the shared glyph sets carry neither, so the surface authors its own monochrome
// stroked vectors in the same style — faithful ports of the lucide path data — recolored at render time by
// `Icon`'s `tint`. Kept self-contained to this surface so the glyphs never couple to another surface's
// icon set, exactly as the sibling AdvancedSettings surface does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationsettings

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The three icons the surface renders, ported 1:1 from the web component's lucide glyphs. All are
 * authored as 24×24 round-capped stroked vectors so they inherit the Material 3 content color in every
 * theme; all are decorative (the surrounding title / button label carries the meaning), so each is
 * rendered with a `null` content description at its call site.
 */
object NotificationSettingsGlyphs {
    /**
     * lucide `Bell` — a bell silhouette with its clapper (the browser-notifications header + Enable button
     * and the events glyph). Faithful port of the lucide path data: the body outline and the clapper arc.
     */
    val Bell: ImageVector =
        stroked("Bell") {
            // Clapper.
            moveTo(10.268f, 21f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = false, dx1 = 3.464f, dy1 = 0f)
            // Body outline.
            moveTo(3.262f, 15.326f)
            arcTo(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 4f, y1 = 17f)
            horizontalLineToRelative(16f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = false, dx1 = 0.74f, dy1 = -1.673f)
            curveTo(19.41f, 13.956f, 18f, 12.499f, 18f, 8f)
            arcTo(6f, 6f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 6f, y1 = 8f)
            curveToRelative(0f, 4.499f, -1.411f, 5.956f, -2.738f, 7.326f)
        }

    /**
     * lucide `Volume2` — a speaker silhouette with two sound waves (the notification-sounds IconBox).
     * Faithful port of the lucide path data: the speaker polygon plus the inner and outer wave arcs.
     */
    val Volume2: ImageVector =
        stroked("Volume2") {
            // Speaker cone.
            moveTo(11f, 5f)
            lineTo(6f, 9f)
            lineTo(2f, 9f)
            lineTo(2f, 15f)
            lineTo(6f, 15f)
            lineTo(11f, 19f)
            close()
            // Inner wave.
            moveTo(15.54f, 8.46f)
            arcToRelative(5f, 5f, 0f, isMoreThanHalf = false, isPositiveArc = true, dx1 = 0f, dy1 = 7.07f)
            // Outer wave.
            moveTo(19.07f, 4.93f)
            arcToRelative(10f, 10f, 0f, isMoreThanHalf = false, isPositiveArc = true, dx1 = 0f, dy1 = 14.14f)
        }

    /**
     * lucide `Play` — a right-pointing triangle (each channel's Test button). Faithful port of the lucide
     * polygon path data, rendered as a round-joined stroked outline.
     */
    val Play: ImageVector =
        stroked("Play") {
            moveTo(6f, 3f)
            lineTo(20f, 12f)
            lineTo(6f, 21f)
            close()
        }

    private fun stroked(
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
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
