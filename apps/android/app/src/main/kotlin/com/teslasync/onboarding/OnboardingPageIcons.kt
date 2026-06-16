// Locally-authored stroked vector glyphs for the OnboardingPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/onboarding/pages/OnboardingPage.tsx imports Sparkles,
// RefreshCw, ArrowRight, BookOpen, ExternalLink, SkipForward). The shared icon catalog (TeslaGlyphs) ships none
// of these and editing it is outside this surface's allowed files, so they are authored here as 24×24 monochrome
// stroked vectors and recolored at render via the `Icon` tint — exactly the approach the sibling A7 ports
// (GlancePageIcons, BatteryHealthPageIcons) document. The "done" check used by the step indicators is supplied
// by the shared Stepper from `TeslaGlyphs.Check`, so it is not redefined here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/onboarding) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.onboarding

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The glyph set this surface needs (the web OnboardingPage lucide icons). Each is a monochrome 24×24 stroked
 * vector recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color
 * automatically.
 */
object OnboardingGlyphs {
    /** Sparkles — web `Sparkles` (the intro header accent). A four-point star with a small companion spark. */
    val Sparkles: ImageVector =
        strokedGlyph("OnboardingSparkles") {
            moveTo(11f, 3f)
            lineTo(12.4f, 8.6f)
            lineTo(18f, 10f)
            lineTo(12.4f, 11.4f)
            lineTo(11f, 17f)
            lineTo(9.6f, 11.4f)
            lineTo(4f, 10f)
            lineTo(9.6f, 8.6f)
            close()
            moveTo(18f, 15f)
            lineTo(18.7f, 17.3f)
            lineTo(21f, 18f)
            lineTo(18.7f, 18.7f)
            lineTo(18f, 21f)
            lineTo(17.3f, 18.7f)
            lineTo(15f, 18f)
            lineTo(17.3f, 17.3f)
            close()
        }

    /** Circular refresh — web `RefreshCw` (the vehicle-sync + "Check again" actions). Two arcs with arrowheads. */
    val RefreshCw: ImageVector =
        strokedGlyph("OnboardingRefreshCw") {
            moveTo(21f, 12f)
            arcTo(9f, 9f, 0f, false, true, 6.2f, 18.8f)
            moveTo(3f, 12f)
            arcTo(9f, 9f, 0f, false, true, 17.8f, 5.2f)
            moveTo(21f, 4f)
            lineTo(21f, 9f)
            lineTo(16f, 9f)
            moveTo(3f, 20f)
            lineTo(3f, 15f)
            lineTo(8f, 15f)
        }

    /** Arrow right — web `ArrowRight` (the connect + continue navigation CTAs). Shaft with a chevron head. */
    val ArrowRight: ImageVector =
        strokedGlyph("OnboardingArrowRight") {
            moveTo(4f, 12f)
            lineTo(20f, 12f)
            moveTo(13f, 5f)
            lineTo(20f, 12f)
            lineTo(13f, 19f)
        }

    /** Open book — web `BookOpen` (the telemetry "Setup guide" link). Two facing pages over a center spine. */
    val BookOpen: ImageVector =
        strokedGlyph("OnboardingBookOpen") {
            moveTo(12f, 6f)
            lineTo(12f, 20f)
            moveTo(12f, 6f)
            curveTo(10f, 4.5f, 6f, 4.5f, 3f, 5f)
            lineTo(3f, 18f)
            curveTo(6f, 17.5f, 10f, 17.5f, 12f, 19f)
            curveTo(14f, 17.5f, 18f, 17.5f, 21f, 18f)
            lineTo(21f, 5f)
            curveTo(18f, 4.5f, 14f, 4.5f, 12f, 6f)
            close()
        }

    /** External link — web `ExternalLink` (trailing the "Setup guide"/doc links). Open box + diagonal out-arrow. */
    val ExternalLink: ImageVector =
        strokedGlyph("OnboardingExternalLink") {
            moveTo(13f, 4f)
            lineTo(11f, 4f)
            curveTo(6f, 4f, 4f, 6f, 4f, 11f)
            lineTo(4f, 13f)
            curveTo(4f, 18f, 6f, 20f, 11f, 20f)
            lineTo(13f, 20f)
            curveTo(18f, 20f, 20f, 18f, 20f, 13f)
            lineTo(20f, 11f)
            moveTo(14f, 3f)
            lineTo(21f, 3f)
            lineTo(21f, 10f)
            moveTo(21f, 3f)
            lineTo(11f, 13f)
        }

    /** Skip forward — web `SkipForward` (the "Skip for now" action). A right-pointing triangle beside a bar. */
    val SkipForward: ImageVector =
        strokedGlyph("OnboardingSkipForward") {
            moveTo(5f, 5f)
            lineTo(15f, 12f)
            lineTo(5f, 19f)
            close()
            moveTo(19f, 5f)
            lineTo(19f, 19f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the stroke color is replaced by the `Icon` tint at render. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
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
