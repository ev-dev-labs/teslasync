// Locally-authored stroked vector glyphs for the AuditLogPage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses (Clock for the "Recent Activity" panel header, AlertTriangle for
// the load-failed state, and a document glyph for the empty state). This mirrors the established A7 precedent
// (ApiLogsPage's glyph set): each glyph is authored locally as a 24×24 stroked vector and recolored at render
// via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.auditlog

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
object AuditLogGlyphs {
    /** Clock — web `Clock` (the "Recent Activity" panel header icon). */
    val Clock: ImageVector =
        strokedGlyph("AuditLogClock") {
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

    /** Warning triangle with a bang — web `AlertTriangle` (the load-failed state). */
    val AlertTriangle: ImageVector =
        strokedGlyph("AuditLogAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12f, 16.6f)
        }

    /** Document with text lines — used for the empty-audit state (web renders a bare message). */
    val FileText: ImageVector =
        strokedGlyph("AuditLogFileText") {
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
}
