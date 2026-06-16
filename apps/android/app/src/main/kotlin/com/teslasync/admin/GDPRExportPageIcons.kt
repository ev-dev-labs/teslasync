// Locally-authored stroked vector glyphs for the GDPRExportPage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses (HardDriveDownload for the empty-state + Download button, Search
// for the lookup button). This mirrors the established admin precedent (ApiLogsPage's glyph set): a glyph is
// authored locally as a 24×24 stroked vector and recolored at render via the Icon/Button `tint`, rather than
// editing the shared TeslaGlyphs catalog (out of scope here). The status-banner icons are supplied by the
// shared AlertBanner's own tone glyphs, so only the two action glyphs are authored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.gdpr

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
object GdprExportGlyphs {
    /** A disk-drive body with a down arrow above it — web `HardDriveDownload` (empty state + Download CTA). */
    val HardDriveDownload: ImageVector =
        strokedGlyph("GdprHardDriveDownload") {
            moveTo(4f, 13f)
            lineTo(20f, 13f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            close()
            moveTo(7.5f, 15.5f)
            lineTo(7.6f, 15.5f)
            moveTo(12f, 3f)
            lineTo(12f, 10f)
            moveTo(9f, 7f)
            lineTo(12f, 10f)
            lineTo(15f, 7f)
        }

    /** Magnifying glass — web `Search` (the Look-up button). */
    val Search: ImageVector =
        strokedGlyph("GdprSearch") {
            moveTo(11f, 4f)
            curveTo(7.1f, 4f, 4f, 7.1f, 4f, 11f)
            curveTo(4f, 14.9f, 7.1f, 18f, 11f, 18f)
            curveTo(14.9f, 18f, 18f, 14.9f, 18f, 11f)
            curveTo(18f, 7.1f, 14.9f, 4f, 11f, 4f)
            close()
            moveTo(16f, 16f)
            lineTo(20f, 20f)
        }
}

/** Map a [GdprStatusTone] to its design-system [BadgeVariant]. */
internal fun GdprStatusTone.badgeVariant(): BadgeVariant =
    when (this) {
        GdprStatusTone.Info -> BadgeVariant.Info
        GdprStatusTone.Success -> BadgeVariant.Success
        GdprStatusTone.Warning -> BadgeVariant.Warning
        GdprStatusTone.Danger -> BadgeVariant.Danger
        GdprStatusTone.Neutral -> BadgeVariant.Neutral
    }
