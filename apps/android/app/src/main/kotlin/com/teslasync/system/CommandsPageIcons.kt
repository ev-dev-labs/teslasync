// Locally-authored stroked vector glyphs for the CommandsPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/system/pages/CommandsPage.tsx imports Car, Wifi, Power, Loader2,
// Activity, AlertTriangle, History). The shared icon catalog (TeslaGlyphs) ships none of these page glyphs and
// editing it is outside this surface's allowed files, so they are authored here as 24×24 monochrome stroked
// vectors and recolored at render via the `Icon` tint — exactly the approach the sibling A7 page surfaces document
// (GlancePageIcons, BatteryHealthPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.commands

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
 * The glyph set this surface needs (the web CommandsPage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object CommandsGlyphs {
    /** Car — web `Car` (the Vehicles metric card + the no-vehicles empty state). Cabin slope, body, two wheels. */
    val Car: ImageVector =
        strokedGlyph("CommandsCar") {
            moveTo(5f, 11f)
            lineTo(6.5f, 7f)
            lineTo(17.5f, 7f)
            lineTo(19f, 11f)
            moveTo(3f, 11f)
            lineTo(21f, 11f)
            lineTo(21f, 15f)
            lineTo(3f, 15f)
            close()
            glyphCircle(7.5f, 15f, 1.5f)
            glyphCircle(16.5f, 15f, 1.5f)
        }

    /** Wi-Fi — web `Wifi` (the Online metric card). Three nested broadcast arcs over a base dot. */
    val Wifi: ImageVector =
        strokedGlyph("CommandsWifi") {
            moveTo(3f, 10f)
            arcTo(11f, 11f, 0f, false, true, 21f, 10f)
            moveTo(6f, 13f)
            arcTo(7f, 7f, 0f, false, true, 18f, 13f)
            moveTo(9f, 16f)
            arcTo(3.5f, 3.5f, 0f, false, true, 15f, 16f)
            glyphCircle(12f, 18.5f, 0.6f)
        }

    /** Power — web `Power` (the Asleep metric card). Top stem + a near-full ring open at the top. */
    val Power: ImageVector =
        strokedGlyph("CommandsPower") {
            moveTo(12f, 4f)
            lineTo(12f, 11f)
            moveTo(8f, 7.5f)
            arcTo(6f, 6f, 0f, true, false, 16f, 7.5f)
        }

    /** Loader — web `Loader2` (the Refresh metric card). A ~270° spinner ring. */
    val Loader: ImageVector =
        strokedGlyph("CommandsLoader") {
            moveTo(12f, 5f)
            arcTo(7f, 7f, 0f, true, true, 19f, 12f)
        }

    /** History — web `History` (the View History header link). Clock face, back-arrow corner, and hands. */
    val History: ImageVector =
        strokedGlyph("CommandsHistory") {
            moveTo(5f, 6f)
            arcTo(7.5f, 7.5f, 0f, true, true, 6f, 17f)
            moveTo(3f, 4f)
            lineTo(3f, 8f)
            lineTo(7f, 8f)
            moveTo(12f, 8f)
            lineTo(12f, 12f)
            lineTo(15f, 13.5f)
        }

    /** Activity — web `Activity` (the no-data stats empty state). A single ECG pulse line. */
    val Activity: ImageVector =
        strokedGlyph("CommandsActivity") {
            moveTo(2f, 12f)
            lineTo(6f, 12f)
            lineTo(9f, 3f)
            lineTo(15f, 21f)
            lineTo(18f, 12f)
            lineTo(22f, 12f)
        }

    /** Alert triangle — web `AlertTriangle` (the states-error banner, GlassPanel5). Triangle + exclamation. */
    val AlertTriangle: ImageVector =
        strokedGlyph("CommandsAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            glyphCircle(12f, 16.5f, 0.5f)
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
