// Locally-authored stroked vector glyphs for the DiskForecastPage surface — the native counterparts of the web
// lucide icons the page uses (`Database` for the empty-hypertables state, web
// `web/src/features/admin/pages/DiskForecastPage.tsx`) plus the `AlertCircle` the native panel draws on its
// load-failed error state (the web error surface is the page-level PageContainer query error). This mirrors the
// established admin-surface precedent (SecretRotationPage's glyph set): a glyph is authored locally as a 24×24
// stroked vector and recolored at render via the Icon/StatCard `tint`, rather than editing the shared
// TeslaGlyphs catalog (out of scope here). The file also maps the framework-free [DiskSeverityTone] to the
// design-system [BadgeVariant] at the render boundary (web `SEVERITY_VARIANT` map).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.diskforecast

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BadgeVariant

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/StatCard `tint` at render. */
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
object DiskForecastGlyphs {
    /** Database cylinder — web `Database` (empty-hypertables state). */
    val Database: ImageVector =
        strokedGlyph("DiskForecastDatabase") {
            // Top ellipse (cx 12, cy 5, rx 7, ry 3).
            moveTo(5f, 5f)
            curveTo(5f, 3.3f, 8.1f, 2f, 12f, 2f)
            curveTo(15.9f, 2f, 19f, 3.3f, 19f, 5f)
            curveTo(19f, 6.7f, 15.9f, 8f, 12f, 8f)
            curveTo(8.1f, 8f, 5f, 6.7f, 5f, 5f)
            close()
            // Cylinder sides + bottom sweep.
            moveTo(5f, 5f)
            lineTo(5f, 19f)
            curveTo(5f, 20.7f, 8.1f, 22f, 12f, 22f)
            curveTo(15.9f, 22f, 19f, 20.7f, 19f, 19f)
            lineTo(19f, 5f)
            // Middle band.
            moveTo(5f, 12f)
            curveTo(5f, 13.7f, 8.1f, 15f, 12f, 15f)
            curveTo(15.9f, 15f, 19f, 13.7f, 19f, 12f)
        }

    /** Circled bang — web `AlertCircle` (load-failed error state). */
    val AlertCircle: ImageVector =
        strokedGlyph("DiskForecastAlertCircle") {
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

/**
 * Map a [DiskSeverityTone] to its design-system [BadgeVariant] — the native mirror of the web
 * `SEVERITY_VARIANT` map (ok ⇒ success, warn ⇒ warning, critical ⇒ danger, unknown ⇒ neutral).
 */
internal fun DiskSeverityTone.badgeVariant(): BadgeVariant =
    when (this) {
        DiskSeverityTone.Ok -> BadgeVariant.Success
        DiskSeverityTone.Warn -> BadgeVariant.Warning
        DiskSeverityTone.Critical -> BadgeVariant.Danger
        DiskSeverityTone.Unknown -> BadgeVariant.Neutral
    }
