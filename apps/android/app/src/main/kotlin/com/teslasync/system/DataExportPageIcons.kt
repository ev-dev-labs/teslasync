// Locally-authored stroked vector glyphs for the DataExportPage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses (Package, HardDrive, BarChart, Clock, FileSpreadsheet, FileJson,
// Database, Car, Bolt, Calendar, Download, FileDown, Refresh, AlertCircle). This mirrors the established
// feature-view precedent (ApiLogsPage's glyph set): a glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon/StatCard `tint`, rather than editing the shared TeslaGlyphs catalog (out of
// scope here). The co-located tone/accent mappings translate the page's domain enums onto the design-system
// palette at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.dataexport

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.PanelAccent

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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
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

/** The local glyph set this surface needs (web lucide icons). */
object DataExportGlyphs {
    /** Down arrow into a tray — web `Download` (submit + history download actions). */
    val Download: ImageVector =
        strokedGlyph("DataExportDownload") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            moveTo(8f, 10f)
            lineTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(5f, 18f)
            lineTo(19f, 18f)
        }

    /** Document with a down arrow — web `FileDown` (wizard title + empty-history icon). */
    val FileDown: ImageVector =
        strokedGlyph("DataExportFileDown") {
            moveTo(6f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(6f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(12f, 11f)
            lineTo(12f, 17f)
            moveTo(9.5f, 14.5f)
            lineTo(12f, 17f)
            lineTo(14.5f, 14.5f)
        }

    /** Two circular arrows — web `RefreshCw` (refresh actions). */
    val Refresh: ImageVector =
        strokedGlyph("DataExportRefresh") {
            moveTo(19f, 8f)
            curveTo(17.5f, 5.5f, 14.9f, 4f, 12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            moveTo(19f, 4f)
            lineTo(19f, 8f)
            lineTo(15f, 8f)
            moveTo(5f, 16f)
            curveTo(6.5f, 18.5f, 9.1f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            moveTo(5f, 20f)
            lineTo(5f, 16f)
            lineTo(9f, 16f)
        }

    /** A 3D shipping box — web `Package` (Total Exports stat + account panel). */
    val Package: ImageVector =
        strokedGlyph("DataExportPackage") {
            moveTo(12f, 3f)
            lineTo(20f, 7f)
            lineTo(20f, 16f)
            lineTo(12f, 20f)
            lineTo(4f, 16f)
            lineTo(4f, 7f)
            close()
            moveTo(4f, 7f)
            lineTo(12f, 11f)
            lineTo(20f, 7f)
            moveTo(12f, 11f)
            lineTo(12f, 20f)
        }

    /** A horizontal disk with an LED — web `HardDrive` (Total Size stat). */
    val HardDrive: ImageVector =
        strokedGlyph("DataExportHardDrive") {
            rect(3f, 7f, 21f, 15f)
            moveTo(15f, 11f)
            lineTo(18f, 11f)
            dot(7f, 11.5f)
        }

    /** Ascending bars — web `BarChart3` (Most Exported stat + analytics type). */
    val BarChart: ImageVector =
        strokedGlyph("DataExportBarChart") {
            moveTo(4f, 20f)
            lineTo(20f, 20f)
            moveTo(7f, 20f)
            lineTo(7f, 14f)
            moveTo(12f, 20f)
            lineTo(12f, 8f)
            moveTo(17f, 20f)
            lineTo(17f, 12f)
        }

    /** A clock face — web `Clock` (Last Export stat). */
    val Clock: ImageVector =
        strokedGlyph("DataExportClock") {
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

    /** A file with a row grid — web `FileSpreadsheet` (CSV info card + format chip). */
    val FileSpreadsheet: ImageVector =
        strokedGlyph("DataExportFileSpreadsheet") {
            moveTo(6f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(6f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(8f, 13f)
            lineTo(17f, 13f)
            moveTo(8f, 17f)
            lineTo(17f, 17f)
            moveTo(11.5f, 11f)
            lineTo(11.5f, 19f)
        }

    /** A file with braces — web `FileJson` (JSON info card + format chip). */
    val FileJson: ImageVector =
        strokedGlyph("DataExportFileJson") {
            moveTo(6f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(6f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(11f, 12f)
            curveTo(9.7f, 12f, 9.7f, 13f, 9.7f, 14f)
            curveTo(9.7f, 15f, 9.2f, 15.5f, 8.7f, 15.5f)
            curveTo(9.2f, 15.5f, 9.7f, 16f, 9.7f, 17f)
            curveTo(9.7f, 18f, 9.7f, 19f, 11f, 19f)
            moveTo(14f, 12f)
            curveTo(15.3f, 12f, 15.3f, 13f, 15.3f, 14f)
            curveTo(15.3f, 15f, 15.8f, 15.5f, 16.3f, 15.5f)
            curveTo(15.8f, 15.5f, 15.3f, 16f, 15.3f, 17f)
            curveTo(15.3f, 18f, 15.3f, 19f, 14f, 19f)
        }

    /** A stacked cylinder — web `Database` (Data Overview header + full-backup type). */
    val Database: ImageVector =
        strokedGlyph("DataExportDatabase") {
            moveTo(5f, 6f)
            curveTo(5f, 4.6f, 8.1f, 3.5f, 12f, 3.5f)
            curveTo(15.9f, 3.5f, 19f, 4.6f, 19f, 6f)
            curveTo(19f, 7.4f, 15.9f, 8.5f, 12f, 8.5f)
            curveTo(8.1f, 8.5f, 5f, 7.4f, 5f, 6f)
            close()
            moveTo(5f, 6f)
            lineTo(5f, 12f)
            curveTo(5f, 13.4f, 8.1f, 14.5f, 12f, 14.5f)
            curveTo(15.9f, 14.5f, 19f, 13.4f, 19f, 12f)
            lineTo(19f, 6f)
            moveTo(5f, 12f)
            lineTo(5f, 18f)
            curveTo(5f, 19.4f, 8.1f, 20.5f, 12f, 20.5f)
            curveTo(15.9f, 20.5f, 19f, 19.4f, 19f, 18f)
            lineTo(19f, 12f)
        }

    /** A car silhouette — web `Car` (Data Overview drives + drives type). */
    val Car: ImageVector =
        strokedGlyph("DataExportCar") {
            moveTo(3f, 13f)
            lineTo(5f, 9f)
            curveTo(5.3f, 8.4f, 5.9f, 8f, 6.6f, 8f)
            lineTo(17.4f, 8f)
            curveTo(18.1f, 8f, 18.7f, 8.4f, 19f, 9f)
            lineTo(21f, 13f)
            lineTo(21f, 16f)
            lineTo(3f, 16f)
            close()
            dot(7f, 16f)
            dot(17f, 16f)
        }

    /** A lightning bolt — web `Zap` (Data Overview charging + charging/energy types). */
    val Bolt: ImageVector =
        strokedGlyph("DataExportBolt") {
            moveTo(13f, 3f)
            lineTo(5f, 13f)
            lineTo(11f, 13f)
            lineTo(10f, 21f)
            lineTo(19f, 10f)
            lineTo(13f, 10f)
            close()
        }

    /** A calendar — web `Calendar` (custom date-range toggle). */
    val Calendar: ImageVector =
        strokedGlyph("DataExportCalendar") {
            rect(4f, 6f, 20f, 20f)
            moveTo(4f, 10f)
            lineTo(20f, 10f)
            moveTo(8f, 4f)
            lineTo(8f, 7f)
            moveTo(16f, 4f)
            lineTo(16f, 7f)
        }

    /** A wrench — web `Wrench` (maintenance type). */
    val Wrench: ImageVector =
        strokedGlyph("DataExportWrench") {
            moveTo(15f, 5f)
            curveTo(16.8f, 5.4f, 18f, 7f, 18f, 8.9f)
            curveTo(18f, 11.1f, 16.2f, 12.9f, 14f, 12.9f)
            curveTo(13.5f, 12.9f, 13f, 12.8f, 12.6f, 12.6f)
            lineTo(6f, 19f)
            lineTo(4f, 17f)
            lineTo(10.4f, 10.6f)
            curveTo(10.2f, 10.1f, 10.1f, 9.6f, 10.1f, 9.1f)
            curveTo(10.1f, 6.9f, 11.9f, 5.1f, 14.1f, 5.1f)
            lineTo(12f, 7f)
            lineTo(13.5f, 9.5f)
            lineTo(16f, 8f)
            close()
        }

    /** A circled bang — web `AlertCircle` (account warning + load-failed banner). */
    val AlertCircle: ImageVector =
        strokedGlyph("DataExportAlertCircle") {
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

/** The leading glyph for each export type's selector card (web `EXPORT_TYPES[].icon`). */
fun ExportType.glyph(): ImageVector =
    when (this) {
        ExportType.Drives -> DataExportGlyphs.Car
        ExportType.Charging -> DataExportGlyphs.Bolt
        ExportType.Trips -> DataExportGlyphs.Car
        ExportType.Analytics -> DataExportGlyphs.BarChart
        ExportType.FullBackup -> DataExportGlyphs.Database
        ExportType.Maintenance -> DataExportGlyphs.Wrench
        ExportType.Energy -> DataExportGlyphs.Bolt
    }

/** The accent that tints a selected export-type card border (web `EXPORT_TYPES[].color` neon). */
fun ExportType.accent(): PanelAccent =
    when (this) {
        ExportType.Drives -> PanelAccent.Info
        ExportType.Charging -> PanelAccent.Success
        ExportType.Trips -> PanelAccent.Info
        ExportType.Analytics -> PanelAccent.Primary
        ExportType.FullBackup -> PanelAccent.Warning
        ExportType.Maintenance -> PanelAccent.Danger
        ExportType.Energy -> PanelAccent.Success
    }

/** The history-row type badge tone (web `TYPE_BADGE_VARIANT`). */
fun ExportType.badgeVariant(): BadgeVariant =
    when (this) {
        ExportType.Drives -> BadgeVariant.Info
        ExportType.Charging -> BadgeVariant.Success
        ExportType.Trips -> BadgeVariant.Info
        ExportType.Analytics -> BadgeVariant.Neutral
        ExportType.FullBackup -> BadgeVariant.Warning
        ExportType.Maintenance -> BadgeVariant.Danger
        ExportType.Energy -> BadgeVariant.Success
    }

/** The history-row status badge tone (web `STATUS_CONFIG[].badgeVariant`). */
fun ExportStatus.badgeVariant(): BadgeVariant =
    when (this) {
        ExportStatus.Queued -> BadgeVariant.Neutral
        ExportStatus.Processing -> BadgeVariant.Info
        ExportStatus.Ready -> BadgeVariant.Success
        ExportStatus.Failed -> BadgeVariant.Danger
        ExportStatus.Expired -> BadgeVariant.Warning
        ExportStatus.Unknown -> BadgeVariant.Neutral
    }

/** The history-row format badge tone (web `FormatBadge`: csv → info, json → warning). */
fun ExportFormat.badgeVariant(): BadgeVariant =
    when (this) {
        ExportFormat.Csv -> BadgeVariant.Info
        ExportFormat.Json -> BadgeVariant.Warning
    }
