// Locally-authored stroked vector glyphs for the SecretRotationPage surface — the native counterparts of the
// web lucide icons (`@/lib/icons`) the page uses (ShieldCheck for the tracked-secrets tile + empty state,
// AlertTriangle for the critical tile, and AlertCircle for the load-failed error state). This mirrors the
// established admin-surface precedent (ApiLogsPage's glyph set): a glyph is authored locally as a 24×24
// stroked vector and recolored at render via the Icon/StatCard `tint`, rather than editing the shared
// TeslaGlyphs catalog (out of scope here). The file also maps the framework-free [SecretSeverityTone] to the
// design-system [BadgeVariant] at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.secretrotation

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
object SecretRotationGlyphs {
    /** Shield with an inner check — web `ShieldCheck` (Tracked-secrets stat + empty-table state). */
    val ShieldCheck: ImageVector =
        strokedGlyph("SecretRotationShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 11f)
            curveTo(19f, 16f, 16f, 19f, 12f, 21f)
            curveTo(8f, 19f, 5f, 16f, 5f, 11f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12f)
            lineTo(11f, 14f)
            lineTo(15f, 10f)
        }

    /** Warning triangle with a bang — web `AlertTriangle` (Critical stat tile). */
    val AlertTriangle: ImageVector =
        strokedGlyph("SecretRotationAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12f, 16.6f)
        }

    /** Circled bang — web `AlertCircle` (load-failed error state). */
    val AlertCircle: ImageVector =
        strokedGlyph("SecretRotationAlertCircle") {
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

/**
 * Map a [SecretSeverityTone] to its design-system [BadgeVariant] — the native mirror of the web
 * `SEVERITY_VARIANT` map (ok ⇒ success, warn ⇒ warning, critical ⇒ danger, unknown ⇒ neutral).
 */
internal fun SecretSeverityTone.badgeVariant(): BadgeVariant =
    when (this) {
        SecretSeverityTone.Ok -> BadgeVariant.Success
        SecretSeverityTone.Warn -> BadgeVariant.Warning
        SecretSeverityTone.Critical -> BadgeVariant.Danger
        SecretSeverityTone.Unknown -> BadgeVariant.Neutral
    }
