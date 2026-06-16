// Locally-authored stroked vector glyphs for the LiveLogsPage surface — the native counterparts of the web
// lucide icons the page uses (ScrollText, AlertTriangle, Pause, Play, Trash2, Download, RefreshCw). This
// mirrors the established admin precedent (ApiLogsPage's glyph set): a glyph is authored locally as a 24×24
// stroked vector and recolored at render via the Icon/Button `tint`, rather than editing the shared
// TeslaGlyphs catalog (out of scope here). Also hosts the model-tone → design-system [BadgeVariant] mappings.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.livelogs

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
object LiveLogsGlyphs {
    /** Curled document with lines — web `ScrollText` (page header + empty-state). */
    val ScrollText: ImageVector =
        strokedGlyph("LiveLogsScrollText") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 17f)
            curveTo(17f, 18.7f, 18.3f, 20f, 20f, 20f)
            lineTo(8f, 20f)
            curveTo(6.3f, 20f, 5f, 18.7f, 5f, 17f)
            lineTo(5f, 7f)
            curveTo(5f, 5.3f, 6.3f, 4f, 8f, 4f)
            moveTo(9f, 9f)
            lineTo(14f, 9f)
            moveTo(9f, 12f)
            lineTo(14f, 12f)
        }

    /** Warning triangle with a bang — web `AlertTriangle` (error panel). */
    val AlertTriangle: ImageVector =
        strokedGlyph("LiveLogsAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12f, 16.6f)
        }

    /** Two vertical bars — web `Pause` (pause control). */
    val Pause: ImageVector =
        strokedGlyph("LiveLogsPause") {
            moveTo(9f, 5f)
            lineTo(9f, 19f)
            moveTo(15f, 5f)
            lineTo(15f, 19f)
        }

    /** Right-pointing triangle — web `Play` (resume control). */
    val Play: ImageVector =
        strokedGlyph("LiveLogsPlay") {
            moveTo(8f, 5f)
            lineTo(19f, 12f)
            lineTo(8f, 19f)
            close()
        }

    /** Trash can with lid — web `Trash2` (clear-buffer control). */
    val Trash: ImageVector =
        strokedGlyph("LiveLogsTrash") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            moveTo(9f, 6f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 6f)
            moveTo(6f, 6f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 6f)
            moveTo(10f, 10f)
            lineTo(10f, 16f)
            moveTo(14f, 10f)
            lineTo(14f, 16f)
        }

    /** Down arrow into a tray — web `Download` (download-visible control). */
    val Download: ImageVector =
        strokedGlyph("LiveLogsDownload") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            moveTo(8f, 10f)
            lineTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(5f, 18f)
            lineTo(19f, 18f)
        }

    /** Circular refresh arrows — web `RefreshCw` (reconnect control). */
    val Refresh: ImageVector =
        strokedGlyph("LiveLogsRefresh") {
            moveTo(20f, 11f)
            curveTo(19.4f, 7.1f, 16f, 4f, 12f, 4f)
            curveTo(9f, 4f, 6.3f, 5.8f, 5f, 8.5f)
            moveTo(4f, 5f)
            lineTo(5f, 8.5f)
            lineTo(8.5f, 7.5f)
            moveTo(4f, 13f)
            curveTo(4.6f, 16.9f, 8f, 20f, 12f, 20f)
            curveTo(15f, 20f, 17.7f, 18.2f, 19f, 15.5f)
            moveTo(20f, 19f)
            lineTo(19f, 15.5f)
            lineTo(15.5f, 16.5f)
        }
}

/** Map a model [LiveLogsTone] to its design-system [BadgeVariant]. */
internal fun LiveLogsTone.badgeVariant(): BadgeVariant =
    when (this) {
        LiveLogsTone.Info -> BadgeVariant.Info
        LiveLogsTone.Success -> BadgeVariant.Success
        LiveLogsTone.Warning -> BadgeVariant.Warning
        LiveLogsTone.Danger -> BadgeVariant.Danger
        LiveLogsTone.Neutral -> BadgeVariant.Neutral
    }

/** Map a [LiveLogsConnection] classification to its connection-badge [BadgeVariant] (web `ConnectionBadge`). */
internal fun LiveLogsConnection.badgeVariant(): BadgeVariant =
    when (this) {
        LiveLogsConnection.Error -> BadgeVariant.Danger
        LiveLogsConnection.Disconnected -> BadgeVariant.Neutral
        LiveLogsConnection.Connecting -> BadgeVariant.Info
        LiveLogsConnection.Paused -> BadgeVariant.Warning
        LiveLogsConnection.Connected -> BadgeVariant.Success
    }
