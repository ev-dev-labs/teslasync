// Self-contained line-style icon for the PedalUsage surface, drawn as a Material [ImageVector].
//
// The web component uses the `lucide-react` `Footprints` glyph that the shared `TeslaGlyphs` /
// `DataDisplayGlyphs` sets do not carry, and Android ships no lucide-equivalent set without the frozen
// `material-icons-extended` artifact. So — exactly as the sibling LiveMotorStatus / LiveVehicleState surfaces
// do for their lucide ports — the one glyph this surface needs is authored here as a 24×24 stroked vector,
// transcribed verbatim from the upstream lucide `footprints` path so it is pixel-faithful. It is monochrome
// (drawn in opaque black) and recolored at render time by the
// [io.teslasync.android.components.ui.Icon] composable's `tint`, so it inherits the muted foreground the web
// renders it with (`text-[var(--text-muted)]`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PedalUsage) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.pedalusage

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyph the PedalUsage brake-status cell renders. */
internal object PedalUsageGlyphs {
    /**
     * lucide `footprints` — two foot outlines with a leading toe stroke each. Transcribed verbatim from the
     * upstream 24×24 path so the native glyph matches the web icon exactly.
     */
    val Footprints: ImageVector =
        stroked("Footprints") {
            // Left foot outline.
            moveTo(4f, 16f)
            verticalLineToRelative(-2.38f)
            curveTo(4f, 11.5f, 2.97f, 10.5f, 3f, 8f)
            curveToRelative(0.03f, -2.72f, 1.49f, -6f, 4.5f, -6f)
            curveTo(9.37f, 2f, 10f, 3.8f, 10f, 5.5f)
            curveToRelative(0f, 3.11f, -2f, 5.66f, -2f, 8.68f)
            verticalLineTo(16f)
            arcToRelative(2f, 2f, 0f, true, true, -4f, 0f)
            close()
            // Right foot outline.
            moveTo(20f, 20f)
            verticalLineToRelative(-2.38f)
            curveToRelative(0f, -1.12f, 1.03f, -2.12f, 1f, -4.62f)
            curveToRelative(-0.03f, -2.72f, -1.49f, -6f, -4.5f, -6f)
            curveTo(14.63f, 7f, 14f, 8.8f, 14f, 10.5f)
            curveToRelative(0f, 3.11f, 2f, 5.66f, 2f, 8.68f)
            verticalLineTo(20f)
            arcToRelative(2f, 2f, 0f, true, false, 4f, 0f)
            close()
            // Toe strokes.
            moveTo(16f, 17f)
            horizontalLineToRelative(4f)
            moveTo(4f, 13f)
            horizontalLineToRelative(4f)
        }
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
