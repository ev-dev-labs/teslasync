// Locally-authored stroked vector glyphs for the DataRepairPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/system/pages/DataRepairPage.tsx imports `Wrench`,
// `BatteryCharging`, `Route`, `AlertTriangle`, `CheckCircle`, `Save`, `Clock`, `Trash2`; the web `X` / `Cancel`
// glyph reuses the shared TeslaGlyphs.Close). This mirrors the established admin-page precedent
// (SchemaDriftPageIcons / IngestXRayPageIcons): each glyph is authored locally as a 24×24 stroked vector and
// recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.datarepair

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
object DataRepairGlyphs {
    /** Open-end wrench — web `Wrench` (the "Status" stat card + the page repair affordance). */
    val Wrench: ImageVector =
        strokedGlyph("DataRepairWrench") {
            moveTo(14.7f, 6.3f)
            arcToRelative(4f, 4f, 0f, isMoreThanHalf = false, isPositiveArc = false, -5.4f, 5.4f)
            lineTo(4f, 17f)
            lineTo(7f, 20f)
            lineTo(12.3f, 14.7f)
            arcToRelative(4f, 4f, 0f, isMoreThanHalf = false, isPositiveArc = false, 5.4f, -5.4f)
            lineTo(15f, 12f)
            lineTo(12f, 9f)
            close()
        }

    /** Battery with a charging bolt — web `BatteryCharging` (the "Stale Charging" stat card + the Charging tab). */
    val BatteryCharging: ImageVector =
        strokedGlyph("DataRepairBatteryCharging") {
            moveTo(6f, 7f)
            lineTo(9.5f, 7f)
            moveTo(14.5f, 7f)
            lineTo(16f, 7f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = true, 2f, 2f)
            lineTo(18f, 15f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = true, -2f, 2f)
            lineTo(14.5f, 17f)
            moveTo(9.5f, 17f)
            lineTo(6f, 17f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = true, -2f, -2f)
            lineTo(4f, 9f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = true, 2f, -2f)
            moveTo(22f, 11f)
            lineTo(22f, 13f)
            moveTo(11f, 7f)
            lineTo(9f, 12.5f)
            lineTo(13f, 12.5f)
            lineTo(11f, 17f)
        }

    /** Two waypoints joined by a route — web `Route` (the "Stale Drives" stat card + the Drives tab). */
    val Route: ImageVector =
        strokedGlyph("DataRepairRoute") {
            moveTo(6.5f, 19f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = false, 0f, -4f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = false, 0f, 4f)
            close()
            moveTo(17.5f, 9f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = false, 0f, -4f)
            arcToRelative(2f, 2f, 0f, isMoreThanHalf = false, isPositiveArc = false, 0f, 4f)
            close()
            moveTo(8.5f, 17f)
            lineTo(14f, 17f)
            arcToRelative(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = false, 0f, -7f)
            lineTo(10f, 10f)
            arcToRelative(3.5f, 3.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 0f, -3f)
            lineTo(15.5f, 7f)
        }

    /** Warning triangle with an exclamation — web `AlertTriangle` (the "Total Stale" card + the "Open" badge). */
    val AlertTriangle: ImageVector =
        strokedGlyph("DataRepairAlertTriangle") {
            moveTo(12f, 3f)
            lineTo(22f, 20f)
            lineTo(2f, 20f)
            close()
            moveTo(12f, 9f)
            lineTo(12f, 14f)
            moveTo(12f, 17f)
            lineTo(12.01f, 17f)
        }

    /** A check inside a circle — web `CheckCircle` (the "all sessions complete" empty state). */
    val CheckCircle: ImageVector =
        strokedGlyph("DataRepairCheckCircle") {
            moveTo(21f, 12f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, -18f, 0f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, 18f, 0f)
            moveTo(8.5f, 12.5f)
            lineTo(11f, 15f)
            lineTo(16f, 9f)
        }

    /** Floppy-disk save — web `Save` (the repair forms' "Save" action). */
    val Save: ImageVector =
        strokedGlyph("DataRepairSave") {
            moveTo(5f, 4f)
            lineTo(16f, 4f)
            lineTo(20f, 8f)
            lineTo(20f, 19f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, -1f, 1f)
            lineTo(5f, 20f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, -1f, -1f)
            lineTo(4f, 5f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, 1f, -1f)
            close()
            moveTo(8f, 4f)
            lineTo(8f, 9f)
            lineTo(15f, 9f)
            lineTo(15f, 4f)
            moveTo(7f, 20f)
            lineTo(7f, 13f)
            lineTo(17f, 13f)
            lineTo(17f, 20f)
        }

    /** Clock face — web `Clock` (the repair forms' "Close Session" / "Close Drive" action). */
    val Clock: ImageVector =
        strokedGlyph("DataRepairClock") {
            moveTo(21f, 12f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, -18f, 0f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, 18f, 0f)
            close()
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** Trash can with lid + slats — web `Trash2` (the repair forms' "Discard" action). */
    val Trash: ImageVector =
        strokedGlyph("DataRepairTrash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(9f, 7f)
            lineTo(9f, 5f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, 1f, -1f)
            lineTo(14f, 4f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = true, 1f, 1f)
            lineTo(15f, 7f)
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = false, 1f, 1f)
            lineTo(16f, 21f)
            arcToRelative(1f, 1f, 0f, isMoreThanHalf = false, isPositiveArc = false, 1f, -1f)
            lineTo(18f, 7f)
            moveTo(10f, 11f)
            lineTo(10f, 17f)
            moveTo(14f, 11f)
            lineTo(14f, 17f)
        }
}
