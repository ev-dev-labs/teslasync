// Page-local line-style icon set for the BackupRestorePage surface, authored as 24×24 stroked [ImageVector]s.
//
// The shared [io.teslasync.android.components.ui.TeslaGlyphs] set is a deliberately small library of the glyphs
// the shared UI primitives need, and it lives outside this surface's allowed files. The web page leans on
// `lucide-react` for Database, Archive, Clock, HardDrive, Cloud, FolderOpen, Play, Pencil, Trash, Plus, Zap,
// Download, ShieldCheck, Eye, and AlertCircle — glyphs the shared set does not carry — so they are authored here,
// monochrome (opaque black) and recolored at render time by the [io.teslasync.android.components.ui.Icon]
// composable's `tint`, inheriting `LocalContentColor` and every theme/state color automatically. This mirrors how
// `TeslaGlyphs` itself authors its vectors, so the visual language stays consistent without pulling the frozen
// `material-icons-extended` artifact.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) cannot match
// the app's `io.teslasync.android.*` package root.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.backuprestore

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The fifteen lucide-parity glyphs the BackupRestorePage renders, drawn as stroked 24×24 vectors. Each is
 * recolored at render time by the [io.teslasync.android.components.ui.Icon] `tint`, so they honour every theme +
 * dynamic-color scheme (ADR-015) without per-glyph color.
 */
object BackupGlyphs {
    /** A storage cylinder (web `Database`). The "Total Configs" metric + the no-configs empty-state glyph. */
    val Database: ImageVector =
        stroked("Database") {
            ellipse(12f, 6f, 7f, 3f)
            moveTo(5f, 6f)
            lineTo(5f, 18f)
            arcTo(7f, 3f, 0f, false, false, 19f, 18f)
            lineTo(19f, 6f)
            moveTo(5f, 12f)
            arcTo(7f, 3f, 0f, false, false, 19f, 12f)
        }

    /** An archive box with a lid + handle (web `Archive`). The "Total Backups" metric glyph. */
    val Archive: ImageVector =
        stroked("Archive") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            lineTo(20f, 10f)
            lineTo(4f, 10f)
            close()
            moveTo(5f, 10f)
            lineTo(5f, 19f)
            lineTo(19f, 19f)
            lineTo(19f, 10f)
            moveTo(10f, 13f)
            lineTo(14f, 13f)
        }

    /** A clock face with two hands (web `Clock`). The "Last Backup" metric + the no-runs empty-state glyph. */
    val Clock: ImageVector =
        stroked("Clock") {
            circle(12f, 12f, 8f)
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** A horizontal disk drive with an activity dot (web `HardDrive`). The "Total Size" metric glyph. */
    val HardDrive: ImageVector =
        stroked("HardDrive") {
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            lineTo(20f, 15f)
            lineTo(4f, 15f)
            close()
            moveTo(7f, 12f)
            lineTo(12f, 12f)
            dot(16.5f, 12f)
        }

    /** A rounded cloud silhouette (web `Cloud`). The remote-provider badge glyph. */
    val Cloud: ImageVector =
        stroked("Cloud") {
            moveTo(8f, 18f)
            lineTo(17f, 18f)
            arcTo(3.6f, 3.6f, 0f, false, false, 17f, 10.8f)
            arcTo(4.8f, 4.8f, 0f, false, false, 8.2f, 9.6f)
            arcTo(3.7f, 3.7f, 0f, false, false, 8f, 18f)
            close()
        }

    /** An open folder (web `FolderOpen`). The local-provider badge glyph. */
    val FolderOpen: ImageVector =
        stroked("FolderOpen") {
            moveTo(4f, 7f)
            lineTo(9f, 7f)
            lineTo(11f, 9f)
            lineTo(20f, 9f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            close()
        }

    /** A right-pointing triangle (web `Play`). The "Trigger now" affordance. */
    val Play: ImageVector =
        stroked("Play") {
            moveTo(8f, 6f)
            lineTo(18f, 12f)
            lineTo(8f, 18f)
            close()
        }

    /** A pencil along the diagonal (web `Pencil`). The edit affordance. */
    val Pencil: ImageVector =
        stroked("Pencil") {
            moveTo(4f, 20f)
            lineTo(8f, 19f)
            lineTo(19f, 8f)
            lineTo(16f, 5f)
            lineTo(5f, 16f)
            close()
        }

    /** A waste bin with a lid + two inner bars (web `Trash2`). The delete affordance. */
    val Trash: ImageVector =
        stroked("Trash") {
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
            lineTo(10f, 17f)
            moveTo(14f, 10f)
            lineTo(14f, 17f)
        }

    /** A plus sign (web `Plus`). The "New Config" affordance. */
    val Plus: ImageVector =
        stroked("Plus") {
            moveTo(12f, 5f)
            lineTo(12f, 19f)
            moveTo(5f, 12f)
            lineTo(19f, 12f)
        }

    /** A lightning bolt (web `Zap`). The "Quick Backup" affordance. */
    val Bolt: ImageVector =
        stroked("Bolt") {
            moveTo(13f, 3f)
            lineTo(6f, 13f)
            lineTo(11f, 13f)
            lineTo(10f, 21f)
            lineTo(18f, 10f)
            lineTo(13f, 10f)
            close()
        }

    /** A down arrow into a tray (web `Download`). The download affordance. */
    val Download: ImageVector =
        stroked("Download") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            moveTo(8f, 10f)
            lineTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(5f, 19f)
            lineTo(19f, 19f)
        }

    /** A shield with a check (web `ShieldCheck`). The verify affordance + the checksum status glyph. */
    val ShieldCheck: ImageVector =
        stroked("ShieldCheck") {
            shieldOutline()
            moveTo(9f, 12f)
            lineTo(11.5f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** An eye with a pupil (web `Eye`). The restore-preview affordance. */
    val Eye: ImageVector =
        stroked("Eye") {
            moveTo(3f, 12f)
            curveTo(7f, 6f, 17f, 6f, 21f, 12f)
            curveTo(17f, 18f, 7f, 18f, 3f, 12f)
            close()
            circle(12f, 12f, 2.6f)
        }

    /** A circled exclamation (web `AlertCircle`). The data-error + recent-failures glyph. */
    val AlertCircle: ImageVector =
        stroked("AlertCircle") {
            circle(12f, 12f, 8f)
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            dot(12f, 16f)
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

/** The shield silhouette shared by [BackupGlyphs.ShieldCheck]. */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 3f)
    lineTo(20f, 6f)
    lineTo(20f, 12f)
    curveTo(20f, 16.5f, 16.5f, 20f, 12f, 21f)
    curveTo(7.5f, 20f, 4f, 16.5f, 4f, 12f)
    lineTo(4f, 6f)
    close()
}

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** Approximates an ellipse of radii ([rx], [ry]) at ([cx], [cy]) with two arcs. */
private fun PathBuilder.ellipse(
    cx: Float,
    cy: Float,
    rx: Float,
    ry: Float,
) {
    moveTo(cx - rx, cy)
    arcTo(rx, ry, 0f, false, true, cx + rx, cy)
    arcTo(rx, ry, 0f, false, true, cx - rx, cy)
    close()
}
