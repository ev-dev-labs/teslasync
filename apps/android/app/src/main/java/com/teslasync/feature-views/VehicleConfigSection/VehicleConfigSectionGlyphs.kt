// Locally-authored 24×24 stroked icon for the VehicleConfigSection surface — the Android stand-in for the web
// `lucide-react` `Settings` gear the panel header renders
// (web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx,
// `<Settings className="h-4 w-4 text-[var(--neon-cyan)]" />`). Android ships no lucide equivalent without
// pulling the frozen `material-icons-extended` artifact, and the shared ui glyph set (`TeslaGlyphs`) carries
// no gear, so — exactly as the sibling GeneralSettings and AdvancedSettings surfaces do for their lucide
// `Settings` ports — this surface authors its own monochrome [ImageVector] in the same toothed-gear style,
// recolored at render time by the shared `Icon` tint. Authoring it here keeps the surface self-contained
// within its allowed-files directory rather than coupling it to another feature's glyph set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleConfigSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleconfigsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The single glyph the VehicleConfigSection header references, authored as a 24×24 round-capped stroked vector
 * so it inherits the Material 3 content color (here the brand primary) in every theme. It is decorative (the
 * adjacent title carries the meaning), so it is rendered with a `null` content description at the call site.
 */
object VehicleConfigSectionGlyphs {
    /** lucide `Settings` — a toothed gear: an 8-tooth silhouette around a center hub (the header accent). */
    val Settings: ImageVector =
        stroked("VehicleConfigSettings") {
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

    /** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
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
