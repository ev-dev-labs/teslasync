// Locally-authored 24×24 stroked icons for the GeneralSettings surface, drawn as Material [ImageVector]s.
// The web component (web/src/features/settings/components/GeneralSettings.tsx) uses six `lucide-react`
// glyphs: `Settings` (the header IconBox), `Download` (the "Sync from Car" button), `Car` (the sync
// panel), `Clock` (the read-only car-clock panel), `Save` (the Save button), and `CheckCircle` (the
// inline "Settings saved" confirmation). Android ships no lucide equivalent and the shared ui glyph set
// (`TeslaGlyphs`) carries none of these, so the surface authors its own monochrome stroked vectors in the
// same style — recolored at render time by `Icon`'s `tint`. Kept self-contained to this surface so the
// glyphs never couple to another surface's icon set, exactly as the sibling AdvancedSettings surface does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GeneralSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.generalsettings

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The six icons the surface renders, ported in spirit from the web component's lucide glyphs. Each is a
 * 24×24 round-capped stroked vector so it inherits the Material 3 content color in every theme; all are
 * decorative (the adjacent title / button label carries the meaning), so each is rendered with a `null`
 * content description at its call site.
 */
object GeneralSettingsGlyphs {
    /** lucide `Settings` — a toothed gear (header IconBox). An 8-tooth silhouette around a center hub. */
    val Settings: ImageVector =
        stroked("Settings") {
            // 8-tooth gear silhouette: 16 vertices alternating tooth-tip (r≈9) and valley (r≈6.5).
            moveTo(21f, 12f)
            lineTo(18.01f, 14.49f)
            lineTo(18.36f, 18.36f)
            lineTo(14.49f, 18.01f)
            lineTo(12f, 21f)
            lineTo(9.51f, 18.01f)
            lineTo(5.64f, 18.36f)
            lineTo(5.99f, 14.49f)
            lineTo(3f, 12f)
            lineTo(5.99f, 9.51f)
            lineTo(5.64f, 5.64f)
            lineTo(9.51f, 5.99f)
            lineTo(12f, 3f)
            lineTo(14.49f, 5.99f)
            lineTo(18.36f, 5.64f)
            lineTo(18.01f, 9.51f)
            close()
            // Center hub.
            circle(centerX = 12f, centerY = 12f, radius = 3f)
        }

    /** lucide `Save` — a floppy disk: notched-corner body, top slot, and bottom shutter. */
    val Save: ImageVector =
        stroked("Save") {
            // Body with the top-right corner notch.
            moveTo(4f, 4f)
            lineTo(16f, 4f)
            lineTo(20f, 8f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            // Bottom shutter.
            moveTo(7f, 20f)
            lineTo(7f, 13f)
            lineTo(17f, 13f)
            lineTo(17f, 20f)
            // Top slot.
            moveTo(7f, 4f)
            lineTo(7f, 8f)
            lineTo(15f, 8f)
        }

    /** lucide `Download` — a down arrow dropping into an open tray. */
    val Download: ImageVector =
        stroked("Download") {
            // Tray.
            moveTo(4f, 15f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 15f)
            // Shaft + arrowhead.
            moveTo(12f, 4f)
            lineTo(12f, 15f)
            moveTo(8f, 11f)
            lineTo(12f, 15f)
            lineTo(16f, 11f)
        }

    /** lucide `Car` — a hatchback silhouette with two wheels. */
    val Car: ImageVector =
        stroked("Car") {
            // Cabin / hood line.
            moveTo(5f, 11f)
            lineTo(7f, 7f)
            lineTo(16f, 7f)
            lineTo(19f, 11f)
            // Body.
            moveTo(3f, 11f)
            lineTo(21f, 11f)
            lineTo(21f, 15f)
            lineTo(3f, 15f)
            close()
            // Wheels.
            circle(centerX = 7.5f, centerY = 16f, radius = 1.5f)
            circle(centerX = 16.5f, centerY = 16f, radius = 1.5f)
        }

    /** lucide `Clock` — a dial with hour + minute hands. */
    val Clock: ImageVector =
        stroked("Clock") {
            circle(centerX = 12f, centerY = 12f, radius = 9f)
            // Hands (12 → 6 → ~4 o'clock).
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** lucide `CheckCircle` — a dial enclosing a checkmark (the inline saved confirmation). */
    val CheckCircle: ImageVector =
        stroked("CheckCircle") {
            circle(centerX = 12f, centerY = 12f, radius = 9f)
            // Checkmark.
            moveTo(8.5f, 12.5f)
            lineTo(11f, 15f)
            lineTo(15.5f, 9.5f)
        }

    /** Draws a full circle centered at ([centerX], [centerY]) of [radius] as two round-capped semicircles. */
    private fun PathBuilder.circle(
        centerX: Float,
        centerY: Float,
        radius: Float,
    ) {
        moveTo(centerX + radius, centerY)
        arcTo(radius, radius, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = centerX - radius, y1 = centerY)
        arcTo(radius, radius, 0f, isMoreThanHalf = false, isPositiveArc = true, x1 = centerX + radius, y1 = centerY)
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
