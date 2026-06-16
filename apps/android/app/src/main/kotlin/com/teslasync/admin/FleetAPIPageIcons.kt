// Locally-authored stroked vector glyphs for the FleetAPIPage surface — the native counterparts of the web
// lucide icons (`lucide-react`) the page uses: Shield (API Endpoint Controls header), Pause / Play (Tesla API
// Polling header + the suspended banner), Globe (API Endpoints header), Link (Configured Endpoints label), and
// Activity (the empty-endpoints state). This mirrors the established admin precedent (ApiLogsPage's glyph
// set): each glyph is authored locally as a 24×24 stroked vector and recolored at render via the Icon /
// IconBox `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.fleetapi

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/IconBox `tint` at render. */
private fun strokedGlyph(
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
                strokeLineWidth = STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** The local glyph set this surface needs (web lucide icons). */
object FleetApiGlyphs {
    /** Shield outline — web `Shield` (API Endpoint Controls header). */
    val Shield: ImageVector =
        strokedGlyph("FleetApiShield") {
            moveTo(12f, 3f)
            lineTo(20f, 6f)
            lineTo(20f, 11f)
            curveTo(20f, 16f, 16.5f, 19f, 12f, 21f)
            curveTo(7.5f, 19f, 4f, 16f, 4f, 11f)
            lineTo(4f, 6f)
            close()
        }

    /** Two vertical bars — web `Pause` (suspended polling state + the suspended banner). */
    val Pause: ImageVector =
        strokedGlyph("FleetApiPause") {
            moveTo(9f, 5f)
            lineTo(9f, 19f)
            moveTo(15f, 5f)
            lineTo(15f, 19f)
        }

    /** Right-pointing triangle — web `Play` (active polling state). */
    val Play: ImageVector =
        strokedGlyph("FleetApiPlay") {
            moveTo(8f, 5f)
            lineTo(8f, 19f)
            lineTo(19f, 12f)
            close()
        }

    /** Circle with meridians — web `Globe` (API Endpoints header). */
    val Globe: ImageVector =
        strokedGlyph("FleetApiGlobe") {
            moveTo(12f, 3f)
            curveTo(7.6f, 3f, 4f, 7f, 4f, 12f)
            curveTo(4f, 17f, 7.6f, 21f, 12f, 21f)
            curveTo(16.4f, 21f, 20f, 17f, 20f, 12f)
            curveTo(20f, 7f, 16.4f, 3f, 12f, 3f)
            close()
            moveTo(4f, 12f)
            lineTo(20f, 12f)
            moveTo(12f, 3f)
            curveTo(9.3f, 6f, 9.3f, 18f, 12f, 21f)
            moveTo(12f, 3f)
            curveTo(14.7f, 6f, 14.7f, 18f, 12f, 21f)
        }

    /** Two chain loops joined by a bar — web `Link` (Configured Endpoints label). */
    val Link: ImageVector =
        strokedGlyph("FleetApiLink") {
            moveTo(8f, 12f)
            lineTo(16f, 12f)
            moveTo(10f, 8f)
            lineTo(7f, 8f)
            curveTo(4.8f, 8f, 3f, 9.8f, 3f, 12f)
            curveTo(3f, 14.2f, 4.8f, 16f, 7f, 16f)
            lineTo(10f, 16f)
            moveTo(14f, 8f)
            lineTo(17f, 8f)
            curveTo(19.2f, 8f, 21f, 9.8f, 21f, 12f)
            curveTo(21f, 14.2f, 19.2f, 16f, 17f, 16f)
            lineTo(14f, 16f)
        }

    /** ECG-style pulse line — web `Activity` (empty-endpoints state). */
    val Activity: ImageVector =
        strokedGlyph("FleetApiActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }
}
