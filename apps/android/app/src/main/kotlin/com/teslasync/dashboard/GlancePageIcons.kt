// Locally-authored stroked vector glyphs for the GlancePage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/dashboard/pages/GlancePage.tsx imports Battery, Thermometer, Lock,
// Unlock, MapPin, Wind, Volume2). The shared icon catalog (TeslaGlyphs) ships none of these vehicle/command
// glyphs and editing it is outside this surface's allowed files, so they are authored here as 24×24 monochrome
// stroked vectors and recolored at render via the `Icon` tint — exactly the approach the sibling A7 / feature-view
// ports (BatteryHealthPageIcons, VehicleCommandCenterGlyphs) document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.glance

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
 * The glyph set this surface needs (the web GlancePage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object GlanceGlyphs {
    /** Battery — web `Battery` (the Range metric + the no-vehicle empty state). Body outline + terminal nub. */
    val Battery: ImageVector =
        strokedGlyph("GlanceBattery") {
            glyphRect(3f, 8f, 18f, 16f)
            moveTo(20.5f, 11f)
            lineTo(20.5f, 13f)
        }

    /** Thermometer — web `Thermometer` (the Interior temperature metric). Stem with a rounded top + bulb. */
    val Thermometer: ImageVector =
        strokedGlyph("GlanceThermometer") {
            moveTo(10f, 13.5f)
            lineTo(10f, 5f)
            arcTo(2f, 2f, 0f, true, true, 14f, 5f)
            lineTo(14f, 13.5f)
            glyphCircle(12f, 16.5f, 3f)
        }

    /** Padlock closed — web `Lock` (the Security metric + lock action when locked). Body + closed shackle. */
    val Lock: ImageVector =
        strokedGlyph("GlanceLock") {
            glyphRect(5f, 11f, 19f, 21f)
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            arcTo(4f, 4f, 0f, true, true, 16f, 7f)
            lineTo(16f, 11f)
        }

    /** Padlock open — web `Unlock` (the Security metric + unlock action when unlocked). Body + open shackle. */
    val Unlock: ImageVector =
        strokedGlyph("GlanceUnlock") {
            glyphRect(5f, 11f, 19f, 21f)
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            arcTo(4f, 4f, 0f, true, true, 16f, 7f)
        }

    /** Map pin — web `MapPin` (the Location metric). Teardrop outline with a center bore. */
    val MapPin: ImageVector =
        strokedGlyph("GlanceMapPin") {
            moveTo(20f, 10f)
            curveTo(20f, 16f, 12f, 22f, 12f, 22f)
            curveTo(12f, 22f, 4f, 16f, 4f, 10f)
            arcTo(8f, 8f, 0f, false, true, 20f, 10f)
            close()
            glyphCircle(12f, 10f, 3f)
        }

    /** Wind — web `Wind` (the climate quick-action). Three trailing gusts curling back. */
    val Wind: ImageVector =
        strokedGlyph("GlanceWind") {
            moveTo(3f, 9f)
            lineTo(13f, 9f)
            curveTo(15.2f, 9f, 15.2f, 6f, 13f, 6f)
            moveTo(3f, 13f)
            lineTo(17f, 13f)
            curveTo(19.5f, 13f, 19.5f, 16f, 17f, 16f)
            moveTo(3f, 16.5f)
            lineTo(10f, 16.5f)
            curveTo(12f, 16.5f, 12f, 19f, 10f, 19f)
        }

    /** Speaker with two waves — web `Volume2` (the horn quick-action). Cone + two sound arcs. */
    val Volume2: ImageVector =
        strokedGlyph("GlanceVolume2") {
            moveTo(11f, 5f)
            lineTo(6f, 9f)
            lineTo(2f, 9f)
            lineTo(2f, 15f)
            lineTo(6f, 15f)
            lineTo(11f, 19f)
            close()
            moveTo(15.5f, 8.5f)
            arcTo(5f, 5f, 0f, false, true, 15.5f, 15.5f)
            moveTo(19.1f, 4.9f)
            arcTo(10f, 10f, 0f, false, true, 19.1f, 19.1f)
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
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
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

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.glyphRect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
