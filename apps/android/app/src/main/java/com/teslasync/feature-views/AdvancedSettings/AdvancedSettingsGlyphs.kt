// Locally-authored 24×24 stroked icons for the Advanced Settings surface, drawn as Material
// [ImageVector]s. The web component (web/src/features/settings/components/AdvancedSettings.tsx) uses two
// `lucide-react` glyphs: `ShieldQuestion` (the header IconBox) and `RotateCcw` (the "Restore all" + each
// per-row "Restore" button). Android ships no lucide equivalent and the shared glyph sets carry neither,
// so the surface authors its own monochrome stroked vectors in the same style — faithful ports of the
// lucide path data — recolored at render time by `Icon`'s `tint`. Kept self-contained to this surface so
// the glyphs never couple to another surface's icon set, exactly as the sibling UuidGenerator surface does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AdvancedSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.advancedsettings

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The two icons the surface renders, ported 1:1 from the web component's lucide glyphs. Both are
 * authored as 24×24 round-capped stroked vectors so they inherit the Material 3 content color in every
 * theme; both are decorative (the surrounding title / button label carries the meaning), so each is
 * rendered with a `null` content description at its call site.
 */
object AdvancedSettingsGlyphs {
    /**
     * lucide `ShieldQuestion` — a shield silhouette enclosing a question mark (the header IconBox glyph).
     * Faithful port of the lucide path data (shield outline, "?" hook, and dot as three subpaths).
     */
    val ShieldQuestion: ImageVector =
        stroked("ShieldQuestion") {
            // Shield silhouette.
            moveTo(20f, 13f)
            curveTo(20f, 18f, 16.5f, 20.5f, 12.34f, 21.95f)
            arcTo(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 11.67f, y1 = 21.94f)
            curveTo(7.5f, 20.5f, 4f, 18f, 4f, 13f)
            lineTo(4f, 6f)
            arcTo(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 5f, y1 = 5f)
            curveTo(7f, 5f, 9.5f, 3.8f, 11.24f, 2.28f)
            arcTo(1.17f, 1.17f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 12.76f, y1 = 2.28f)
            curveTo(14.51f, 3.81f, 17f, 5f, 19f, 5f)
            arcTo(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 20f, y1 = 6f)
            close()
            // Question-mark hook.
            moveTo(9.1f, 9f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = 14.92f, y1 = 10f)
            curveTo(14.92f, 12f, 11.92f, 13f, 11.92f, 13f)
            // Question-mark dot (a hairline segment rendered round-capped as a point).
            moveTo(12f, 17f)
            lineTo(12.01f, 17f)
        }

    /**
     * lucide `RotateCcw` — a counter-clockwise circular arrow (the "Restore" affordances). Faithful port
     * of the lucide path data: the near-full rotation arc plus the open arrowhead at the top-left.
     */
    val RotateCcw: ImageVector =
        stroked("RotateCcw") {
            moveTo(3f, 12f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = false, x1 = 12f, y1 = 3f)
            arcTo(9.75f, 9.75f, 0f, isMoreThanHalf = false, isPositiveArc = false, x1 = 5.26f, y1 = 5.74f)
            lineTo(3f, 8f)
            // Arrowhead.
            moveTo(3f, 3f)
            lineTo(3f, 8f)
            lineTo(8f, 8f)
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
