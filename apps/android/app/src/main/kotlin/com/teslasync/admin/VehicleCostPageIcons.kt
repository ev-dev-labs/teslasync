// Locally-authored stroked vector glyphs for the VehicleCostPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/admin/pages/VehicleCostPage.tsx imports `Wallet` for the
// no-vehicle empty state; the page also draws a circled-bang error affordance). This mirrors the established
// admin-page precedent (SlowQueriesPageIcons / SchemaDriftPageIcons): each glyph is authored locally as a 24×24
// stroked vector and recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog
// (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.vehiclecost

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon `tint` at render. */
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
object VehicleCostGlyphs {
    /** Billfold with a snap pocket — web `Wallet` (the no-vehicle-cost empty state). */
    val Wallet: ImageVector =
        strokedGlyph("VehicleCostWallet") {
            // Wallet body — a rounded rectangle from (3,6) to (21,19).
            moveTo(5f, 6f)
            lineTo(19f, 6f)
            curveTo(20.1f, 6f, 21f, 6.9f, 21f, 8f)
            lineTo(21f, 17f)
            curveTo(21f, 18.1f, 20.1f, 19f, 19f, 19f)
            lineTo(5f, 19f)
            curveTo(3.9f, 19f, 3f, 18.1f, 3f, 17f)
            lineTo(3f, 7f)
            curveTo(3f, 5.9f, 3.9f, 5f, 5f, 5f)
            lineTo(17f, 5f)
            // Snap-pocket compartment line + clasp dot.
            moveTo(16f, 12f)
            lineTo(21f, 12f)
            moveTo(16.5f, 12f)
            lineTo(16.6f, 12f)
        }

    /** Circled bang — the load-failed error affordance (web page-tier error). */
    val AlertCircle: ImageVector =
        strokedGlyph("VehicleCostAlertCircle") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            moveTo(12f, 15.5f)
            lineTo(12f, 15.6f)
        }
}
