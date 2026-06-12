// Locally-authored 24×24 stroked icons for the BackupActionsCard surface — the Android stand-ins for the web
// `lucide-react` glyphs the card renders (`Play` on the run button, `ExternalLink` on the manage-backups link)
// plus a `Database` header glyph. Android ships no lucide equivalent without pulling the frozen
// `material-icons-extended` artifact, so the surface authors its own monochrome [ImageVector]s (recolored at
// render time by the shared `Icon`/`Button` content color) — the same approach the sibling UserImpersonateButton
// and ResetSection surfaces take. Authoring them here keeps the surface self-contained within its allowed-files
// directory rather than coupling it to another feature's glyph set.
//
// The path data reproduces lucide `play`, `external-link`, and `database` verbatim so the native card reads
// identically to the web one.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackupActionsCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backupactionscard

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The three glyphs the BackupActionsCard references, each authored as a 24×24 round-capped stroked vector so it
 * inherits the Material 3 content color in every theme/state. They are decorative (the buttons + header carry
 * the meaning), so each is rendered with a `null` content description at the call site.
 */
object BackupActionsCardGlyphs {
    /** lucide `Play` — the right-pointing triangle on the "Run quick backup now" button. */
    val Play: ImageVector =
        glyph("BackupActionsCardPlay") {
            moveTo(6f, 3f)
            lineTo(20f, 12f)
            lineTo(6f, 21f)
            close()
        }

    /** lucide `ExternalLink` — a framed box with an out-arrow, on the "Manage backups & restore" affordance. */
    val ExternalLink: ImageVector =
        glyph("BackupActionsCardExternalLink") {
            // Arrow head corner (lucide `M15 3h6v6`).
            moveTo(15f, 3f)
            lineTo(21f, 3f)
            lineTo(21f, 9f)
            // Diagonal shaft (lucide `M10 14 21 3`).
            moveTo(10f, 14f)
            lineTo(21f, 3f)
            // Rounded frame (lucide `M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6`).
            moveTo(18f, 13f)
            lineTo(18f, 19f)
            arcTo(2f, 2f, 0f, false, true, 16f, 21f)
            lineTo(5f, 21f)
            arcTo(2f, 2f, 0f, false, true, 3f, 19f)
            lineTo(3f, 5f)
            arcTo(2f, 2f, 0f, false, true, 5f, 3f)
            lineTo(11f, 3f)
        }

    /** lucide `Database` — the stacked cylinder for the card header. */
    val Database: ImageVector =
        glyph("BackupActionsCardDatabase") {
            // Top ellipse (lucide `ellipse cx=12 cy=5 rx=9 ry=3`).
            ellipse(12f, 5f, 9f, 3f)
            // Body sides + bottom arc (lucide `M3 5V19A9 3 0 0 0 21 19V5`).
            moveTo(3f, 5f)
            lineTo(3f, 19f)
            arcTo(9f, 3f, 0f, false, false, 21f, 19f)
            lineTo(21f, 5f)
            // Middle seam (lucide `M3 12A9 3 0 0 0 21 12`).
            moveTo(3f, 12f)
            arcTo(9f, 3f, 0f, false, false, 21f, 12f)
        }
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = pathBuilder,
            )
        }.build()

/** Emits a full ellipse of radii ([rx], [ry]) centered at ([cx], [cy]) as two semi-elliptical arcs. */
private fun PathBuilder.ellipse(
    cx: Float,
    cy: Float,
    rx: Float,
    ry: Float,
) {
    moveTo(cx - rx, cy)
    arcTo(rx, ry, 0f, false, true, cx + rx, cy)
    arcTo(rx, ry, 0f, false, true, cx - rx, cy)
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
