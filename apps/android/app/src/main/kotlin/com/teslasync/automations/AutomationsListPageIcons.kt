// Locally-authored stroked vector glyphs for the AutomationsListPage surface — the native counterparts of the
// web lucide icons (`@/lib/icons`) the page uses (Zap, Plus, Upload, ListFilter, AlertTriangle, Pause, Power,
// ShieldOff, Sparkles, ChevronRight + the per-card action glyphs Play / Trash / RefreshCw). This mirrors the
// established admin/ApiLogsPage precedent: a glyph is authored locally as a 24×24 stroked vector and recolored
// at render via the Icon/Button `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here).
// Plus and ChevronRight already exist in TeslaGlyphs and are reused from there.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/Button `tint` at render. */
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
object AutomationsGlyphs {
    /** Lightning bolt — web `Zap` (empty-state icon + automation accent). */
    val Zap: ImageVector =
        strokedGlyph("AutomationsZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** Up arrow out of a tray — web `Upload` (Import action). */
    val Upload: ImageVector =
        strokedGlyph("AutomationsUpload") {
            moveTo(12f, 15f)
            lineTo(12f, 4f)
            moveTo(8f, 8f)
            lineTo(12f, 4f)
            lineTo(16f, 8f)
            moveTo(5f, 18f)
            lineTo(19f, 18f)
        }

    /** Decreasing horizontal bars — web `ListFilter` (Total stat + filters). */
    val ListFilter: ImageVector =
        strokedGlyph("AutomationsListFilter") {
            moveTo(3f, 6f)
            lineTo(21f, 6f)
            moveTo(6f, 12f)
            lineTo(18f, 12f)
            moveTo(9f, 18f)
            lineTo(15f, 18f)
        }

    /** Warning triangle with a bang — web `AlertTriangle` (auto-disabled warning banner). */
    val AlertTriangle: ImageVector =
        strokedGlyph("AutomationsAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12f, 16.6f)
        }

    /** Two vertical bars — web `Pause` (Disabled stat). */
    val Pause: ImageVector =
        strokedGlyph("AutomationsPause") {
            moveTo(9f, 5f)
            lineTo(9f, 19f)
            moveTo(15f, 5f)
            lineTo(15f, 19f)
        }

    /** Power symbol — web `Power` (Active stat + enable affordance). */
    val Power: ImageVector =
        strokedGlyph("AutomationsPower") {
            moveTo(12f, 3f)
            lineTo(12f, 12f)
            moveTo(8f, 6.5f)
            curveTo(5.6f, 8.1f, 4f, 10.8f, 4f, 13.5f)
            curveTo(4f, 17.9f, 7.6f, 21f, 12f, 21f)
            curveTo(16.4f, 21f, 20f, 17.9f, 20f, 13.5f)
            curveTo(20f, 10.8f, 18.4f, 8.1f, 16f, 6.5f)
        }

    /** Shield with a slash — web `ShieldOff` (Auto-Disabled stat). */
    val ShieldOff: ImageVector =
        strokedGlyph("AutomationsShieldOff") {
            moveTo(12f, 3f)
            lineTo(20f, 6f)
            lineTo(20f, 11f)
            curveTo(20f, 16f, 16.4f, 19.5f, 12f, 21f)
            curveTo(10f, 20.3f, 8.2f, 19.1f, 6.8f, 17.6f)
            moveTo(5.4f, 15f)
            curveTo(4.5f, 13.8f, 4f, 12.4f, 4f, 11f)
            lineTo(4f, 6f)
            lineTo(8.5f, 4.3f)
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    /** Four-point sparkle — web `Sparkles` (Quick Start Templates header). */
    val Sparkles: ImageVector =
        strokedGlyph("AutomationsSparkles") {
            moveTo(12f, 3f)
            lineTo(13.6f, 9.4f)
            lineTo(20f, 11f)
            lineTo(13.6f, 12.6f)
            lineTo(12f, 19f)
            lineTo(10.4f, 12.6f)
            lineTo(4f, 11f)
            lineTo(10.4f, 9.4f)
            close()
            moveTo(18.5f, 4f)
            lineTo(18.5f, 7f)
            moveTo(17f, 5.5f)
            lineTo(20f, 5.5f)
        }

    /** Filled-style triangle — web `Play` (per-card Test Run action). */
    val Play: ImageVector =
        strokedGlyph("AutomationsPlay") {
            moveTo(8f, 5f)
            lineTo(8f, 19f)
            lineTo(19f, 12f)
            close()
        }

    /** Trash can — web `Trash2` (per-card Delete action). */
    val Trash: ImageVector =
        strokedGlyph("AutomationsTrash") {
            moveTo(5f, 7f)
            lineTo(19f, 7f)
            moveTo(10f, 4f)
            lineTo(14f, 4f)
            moveTo(6.5f, 7f)
            lineTo(7.5f, 20f)
            lineTo(16.5f, 20f)
            lineTo(17.5f, 7f)
            moveTo(10f, 11f)
            lineTo(10f, 17f)
            moveTo(14f, 11f)
            lineTo(14f, 17f)
        }

    /** Circular refresh arrows — web `RefreshCw` (per-card Re-enable action). */
    val RefreshCw: ImageVector =
        strokedGlyph("AutomationsRefreshCw") {
            moveTo(20.5f, 12f)
            curveTo(20.5f, 7.3f, 16.7f, 3.5f, 12f, 3.5f)
            curveTo(8.6f, 3.5f, 5.7f, 5.5f, 4.3f, 8.3f)
            moveTo(20f, 4f)
            lineTo(20.3f, 8.3f)
            lineTo(16f, 8.6f)
            moveTo(3.5f, 12f)
            curveTo(3.5f, 16.7f, 7.3f, 20.5f, 12f, 20.5f)
            curveTo(15.4f, 20.5f, 18.3f, 18.5f, 19.7f, 15.7f)
            moveTo(4f, 20f)
            lineTo(3.7f, 15.7f)
            lineTo(8f, 15.4f)
        }
}
