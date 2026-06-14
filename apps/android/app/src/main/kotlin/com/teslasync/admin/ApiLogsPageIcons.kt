// Locally-authored stroked vector glyphs for the ApiLogsPage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses (FileText, AlertTriangle, Clock, Activity, Download, Filter,
// Search, the row chevrons, and the error-banner AlertCircle). This mirrors the established feature-view
// precedent (AlertStudioPage's glyph set): a glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon/StatCard `tint`, rather than editing the shared TeslaGlyphs catalog
// (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.apilogs

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

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
object ApiLogsGlyphs {
    /** Document with text lines — web `FileText` (Total Calls stat + empty-logs state). */
    val FileText: ImageVector =
        strokedGlyph("ApiLogsFileText") {
            moveTo(6f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(6f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(9f, 12f)
            lineTo(16f, 12f)
            moveTo(9f, 15f)
            lineTo(16f, 15f)
            moveTo(9f, 18f)
            lineTo(13f, 18f)
        }

    /** Warning triangle with a bang — web `AlertTriangle` (Error Rate stat). */
    val AlertTriangle: ImageVector =
        strokedGlyph("ApiLogsAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12f, 16.6f)
        }

    /** Clock — web `Clock` (Avg Duration stat). */
    val Clock: ImageVector =
        strokedGlyph("ApiLogsClock") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15f, 14f)
        }

    /** ECG-style pulse line — web `Activity` (Last 24h stat). */
    val Activity: ImageVector =
        strokedGlyph("ApiLogsActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Down arrow into a tray — web `Download` (Export JSON action). */
    val Download: ImageVector =
        strokedGlyph("ApiLogsDownload") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            moveTo(8f, 10f)
            lineTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(5f, 18f)
            lineTo(19f, 18f)
        }

    /** Funnel — web `Filter` (Filters panel header). */
    val Filter: ImageVector =
        strokedGlyph("ApiLogsFilter") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(14f, 12f)
            lineTo(14f, 19f)
            lineTo(10f, 17f)
            lineTo(10f, 12f)
            close()
        }

    /** Magnifying glass — web `Search` (endpoint filter field). */
    val Search: ImageVector =
        strokedGlyph("ApiLogsSearch") {
            moveTo(11f, 4f)
            curveTo(7.1f, 4f, 4f, 7.1f, 4f, 11f)
            curveTo(4f, 14.9f, 7.1f, 18f, 11f, 18f)
            curveTo(14.9f, 18f, 18f, 14.9f, 18f, 11f)
            curveTo(18f, 7.1f, 14.9f, 4f, 11f, 4f)
            close()
            moveTo(16f, 16f)
            lineTo(20f, 20f)
        }

    /** Down chevron — web `ChevronDown` (collapsed log row). */
    val ChevronDown: ImageVector =
        strokedGlyph("ApiLogsChevronDown") {
            moveTo(7f, 10f)
            lineTo(12f, 15f)
            lineTo(17f, 10f)
        }

    /** Up chevron — web `ChevronUp` (expanded log row). */
    val ChevronUp: ImageVector =
        strokedGlyph("ApiLogsChevronUp") {
            moveTo(7f, 14f)
            lineTo(12f, 9f)
            lineTo(17f, 14f)
        }

    /** Circled bang — web `AlertCircle` (load-failed banner). */
    val AlertCircle: ImageVector =
        strokedGlyph("ApiLogsAlertCircle") {
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

/** Map a [LogTone] to its design-system [io.teslasync.android.components.ui.BadgeVariant]. */
internal fun LogTone.badgeVariant(): io.teslasync.android.components.ui.BadgeVariant =
    when (this) {
        LogTone.Success -> io.teslasync.android.components.ui.BadgeVariant.Success
        LogTone.Info -> io.teslasync.android.components.ui.BadgeVariant.Info
        LogTone.Warning -> io.teslasync.android.components.ui.BadgeVariant.Warning
        LogTone.Danger -> io.teslasync.android.components.ui.BadgeVariant.Danger
        LogTone.Neutral -> io.teslasync.android.components.ui.BadgeVariant.Neutral
    }
