// Locally-authored stroked vector glyphs for the FeedbackQueuePage surface — the native counterparts of the
// web lucide icons the page uses (the `Bug` empty-state / forward glyph, the `RefreshCw` refresh control, and
// the `ExternalLink` open-issue affordance). This mirrors the established admin precedent (ApiLogsPage's
// glyph set): a glyph is authored locally as a 24×24 stroked vector and recolored at render via the Icon
// `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here). Chevrons + the error
// octagon reuse the shared [io.teslasync.android.components.ui.TeslaGlyphs].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.feedback

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

/** The local glyph set this surface needs (web lucide icons not present in the shared catalog). */
object FeedbackGlyphs {
    /** Insect with antennae + legs — web `Bug` (empty-state icon + Forward-to-GitHub action). */
    val Bug: ImageVector =
        strokedGlyph("FeedbackBug") {
            // Body
            moveTo(9f, 8f)
            curveTo(9f, 6.3f, 10.3f, 5f, 12f, 5f)
            curveTo(13.7f, 5f, 15f, 6.3f, 15f, 8f)
            moveTo(8f, 9f)
            lineTo(16f, 9f)
            curveTo(16f, 14f, 14.2f, 19f, 12f, 19f)
            curveTo(9.8f, 19f, 8f, 14f, 8f, 9f)
            close()
            moveTo(12f, 9f)
            lineTo(12f, 19f)
            // Antennae
            moveTo(10f, 5.5f)
            lineTo(8.5f, 3.5f)
            moveTo(14f, 5.5f)
            lineTo(15.5f, 3.5f)
            // Left legs
            moveTo(8f, 11f)
            lineTo(4.5f, 10f)
            moveTo(8f, 14f)
            lineTo(4.5f, 14f)
            moveTo(8.3f, 17f)
            lineTo(5f, 18.5f)
            // Right legs
            moveTo(16f, 11f)
            lineTo(19.5f, 10f)
            moveTo(16f, 14f)
            lineTo(19.5f, 14f)
            moveTo(15.7f, 17f)
            lineTo(19f, 18.5f)
        }

    /** Two circular arrows — web `RefreshCw` (the Refresh control). */
    val Refresh: ImageVector =
        strokedGlyph("FeedbackRefresh") {
            moveTo(20f, 11f)
            curveTo(19.5f, 7.1f, 16.1f, 4f, 12f, 4f)
            curveTo(9.2f, 4f, 6.7f, 5.4f, 5.3f, 7.5f)
            moveTo(4f, 13f)
            curveTo(4.5f, 16.9f, 7.9f, 20f, 12f, 20f)
            curveTo(14.8f, 20f, 17.3f, 18.6f, 18.7f, 16.5f)
            // Top-right arrowhead
            moveTo(20f, 5f)
            lineTo(20f, 11f)
            lineTo(14f, 11f)
            // Bottom-left arrowhead
            moveTo(4f, 19f)
            lineTo(4f, 13f)
            lineTo(10f, 13f)
        }

    /** Box with an arrow leaving the top-right — web `ExternalLink` (Open issue). */
    val ExternalLink: ImageVector =
        strokedGlyph("FeedbackExternalLink") {
            moveTo(13f, 5f)
            lineTo(6f, 5f)
            curveTo(5.4f, 5f, 5f, 5.4f, 5f, 6f)
            lineTo(5f, 18f)
            curveTo(5f, 18.6f, 5.4f, 19f, 6f, 19f)
            lineTo(18f, 19f)
            curveTo(18.6f, 19f, 19f, 18.6f, 19f, 18f)
            lineTo(19f, 11f)
            moveTo(15f, 5f)
            lineTo(19f, 5f)
            lineTo(19f, 9f)
            moveTo(19f, 5f)
            lineTo(11f, 13f)
        }
}

/** Map a [FeedbackTone] to its design-system [BadgeVariant]. */
internal fun FeedbackTone.badgeVariant(): BadgeVariant =
    when (this) {
        FeedbackTone.Info -> BadgeVariant.Info
        FeedbackTone.Success -> BadgeVariant.Success
        FeedbackTone.Warning -> BadgeVariant.Warning
        FeedbackTone.Danger -> BadgeVariant.Danger
        FeedbackTone.Neutral -> BadgeVariant.Neutral
    }
