// Line-style shield glyphs for the TeslaAuthCard feature view, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` (`ShieldCheck`, `ShieldAlert`, `ShieldX`, plus `ExternalLink`). The shared
// data-display set already ships `ExternalLink` (and a plain `Shield`), so this file authors only the three shield
// status variants the shared sets lack — as 24×24 stroked vectors in the shared monochrome style (the same
// hand-authored approach as `components/ui/TeslaGlyphs` and the sibling VehicleHero / AlertCard surfaces, since a
// feature view may not expand the shared icon library from a surface prompt's allowed files). Each is monochrome
// and recolored at render time by the `Icon` composable's `tint`, so they track the active theme.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TeslaAuthCard) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaauthcard

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The three lucide shield-status glyphs the card needs that the shared data-display / ui sets do not provide. */
object TeslaAuthCardGlyphs {
    /** lucide `ShieldCheck` — the healthy "Connected" state. Shield outline + an inner check mark. */
    val ShieldCheck: ImageVector =
        authStroked("TeslaAuthShieldCheck") {
            shieldOutline()
            moveTo(9f, 12f)
            lineTo(11f, 14f)
            lineTo(15f, 10f)
        }

    /** lucide `ShieldAlert` — the "Expires soon" / "Unknown" states. Shield outline + an exclamation. */
    val ShieldAlert: ImageVector =
        authStroked("TeslaAuthShieldAlert") {
            shieldOutline()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            moveTo(12f, 16f)
            lineTo(12.01f, 16f)
        }

    /** lucide `ShieldX` — the "Token expired" / "Not connected" states. Shield outline + an inner cross. */
    val ShieldX: ImageVector =
        authStroked("TeslaAuthShieldX") {
            shieldOutline()
            moveTo(9.5f, 9.5f)
            lineTo(14.5f, 14.5f)
            moveTo(14.5f, 9.5f)
            lineTo(9.5f, 14.5f)
        }
}

/** The shared lucide shield outline subpath all three variants draw before their status mark. */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 3f)
    lineTo(19f, 6f)
    lineTo(19f, 12f)
    curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
    curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
    lineTo(5f, 6f)
    close()
}

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun authStroked(
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
