// Line-style icons the SettingsExportImport surface needs that aren't already in `ui.TeslaGlyphs` or
// `feedback.FeedbackGlyphs`. The web component uses `lucide-react` (Database / Upload / FileJson); Android has
// no bundled equivalent without the frozen `material-icons-extended` artifact, so these three are authored here
// as 24×24 stroked vectors in the same monochrome style as the shared sets, recolored at render time by the
// `Icon` composable's `tint`. (Download reuses `FeedbackGlyphs.Download`; the error triangle reuses
// `TeslaGlyphs.Warning`.)
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/SettingsExportImport) cannot form a valid Kotlin package and the file
// hosts the icon set plus its private builder helper.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.settingsexportimport

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The three line glyphs this surface needs (web lucide Database / Upload / FileJson), drawn as [ImageVector]s. */
object SettingsExportImportGlyphs {
    /** A database cylinder — the export/backup header mark (web `Database`). */
    val Database: ImageVector =
        stroked("Database") {
            moveTo(5f, 6f)
            arcTo(7f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = true, 19f, 6f)
            arcTo(7f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = true, 5f, 6f)
            close()
            moveTo(5f, 6f)
            lineTo(5f, 18f)
            moveTo(19f, 6f)
            lineTo(19f, 18f)
            moveTo(5f, 12f)
            arcTo(7f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = false, 19f, 12f)
            moveTo(5f, 18f)
            arcTo(7f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = false, 19f, 18f)
        }

    /** An up-arrow rising out of a tray — the "Choose a file" affordance (web `Upload`). */
    val Upload: ImageVector =
        stroked("Upload") {
            moveTo(12f, 4f)
            lineTo(12f, 15f)
            moveTo(7f, 9f)
            lineTo(12f, 4f)
            lineTo(17f, 9f)
            moveTo(4f, 19f)
            lineTo(20f, 19f)
        }

    /** A document with a folded corner and braces — the drop-zone mark (web `FileJson`). */
    val FileJson: ImageVector =
        stroked("FileJson") {
            moveTo(6f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(6f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(11f, 13f)
            curveTo(10f, 14f, 10f, 15f, 9.5f, 16f)
            curveTo(10f, 17f, 10f, 18f, 11f, 19f)
            moveTo(14f, 13f)
            curveTo(15f, 14f, 15f, 15f, 15.5f, 16f)
            curveTo(15f, 17f, 15f, 18f, 14f, 19f)
        }

    private fun stroked(
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
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}
