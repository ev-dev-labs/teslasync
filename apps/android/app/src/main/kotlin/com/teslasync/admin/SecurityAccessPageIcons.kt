// Locally-authored stroked vector glyphs for the SecurityAccessPage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses (Shield / ShieldAlert for the secure-vs-unsecure status panel,
// AlertCircle for the error banner, Lock for the lock-status row, Eye for the live-state indicator). This mirrors
// the established sibling-surface precedent (ApiLogsPage's glyph set): a glyph is authored locally as a 24×24
// stroked vector and recolored at render via the Icon `tint`, rather than editing the shared TeslaGlyphs catalog
// (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.securityaccess

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
object SecurityGlyphs {
    /** Plain shield — web `Shield` (the "secure" status header). */
    val Shield: ImageVector =
        strokedGlyph("SecurityShield") {
            shieldOutline()
        }

    /** Shield with a centered bang — web `ShieldAlert` / `AlertTriangle` (the "may not be secure" alert). */
    val ShieldAlert: ImageVector =
        strokedGlyph("SecurityShieldAlert") {
            shieldOutline()
            moveTo(12f, 9f)
            lineTo(12f, 13f)
            moveTo(12f, 15.5f)
            lineTo(12f, 15.6f)
        }

    /** Circle with a bang — web `AlertCircle` (the load-failed error banner). */
    val AlertCircle: ImageVector =
        strokedGlyph("SecurityAlertCircle") {
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

    /** Padlock — web `Lock` (the lock-status row). */
    val Lock: ImageVector =
        strokedGlyph("SecurityLock") {
            moveTo(6f, 11f)
            lineTo(18f, 11f)
            lineTo(18f, 20f)
            lineTo(6f, 20f)
            close()
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
            curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
            lineTo(16f, 11f)
        }

    /** Eye — web `Eye` (the live-state "Live" indicator + sentry surveillance cue). */
    val Eye: ImageVector =
        strokedGlyph("SecurityEye") {
            moveTo(2f, 12f)
            curveTo(4f, 7f, 8f, 5f, 12f, 5f)
            curveTo(16f, 5f, 20f, 7f, 22f, 12f)
            curveTo(20f, 17f, 16f, 19f, 12f, 19f)
            curveTo(8f, 19f, 4f, 17f, 2f, 12f)
            close()
            moveTo(12f, 9f)
            curveTo(13.7f, 9f, 15f, 10.3f, 15f, 12f)
            curveTo(15f, 13.7f, 13.7f, 15f, 12f, 15f)
            curveTo(10.3f, 15f, 9f, 13.7f, 9f, 12f)
            curveTo(9f, 10.3f, 10.3f, 9f, 12f, 9f)
            close()
        }
}

/** The shared shield outline used by both [SecurityGlyphs.Shield] and [SecurityGlyphs.ShieldAlert]. */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 3f)
    lineTo(20f, 6f)
    lineTo(20f, 11f)
    curveTo(20f, 16f, 16f, 19.2f, 12f, 21f)
    curveTo(8f, 19.2f, 4f, 16f, 4f, 11f)
    lineTo(4f, 6f)
    close()
}
