// Locally authored line-style glyphs for the three web lucide icons this surface needs that are absent
// from every shared catalog (ServerCrash, Database, Radio), drawn as 24×24 stroked [ImageVector]s and
// recolored at render time by the [io.teslasync.android.components.ui.Icon] tint. The web library uses
// `lucide-react`; Android has no bundled equivalent without the frozen `material-icons-extended`
// artifact, and this surface's allowed-files scope forbids editing the shared glyph catalogs, so these
// three are authored here — the same approach the shared glyph sets and the ReferenceLinksSection /
// NotificationStats surfaces take. The remaining two web icons (AlertTriangle, Zap) already exist in the
// shared catalogs and are reused by the composable (TeslaGlyphs.Warning, FeedbackGlyphs.Bolt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RedisDiagnosticEmptyState) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.redisdiagnosticemptystate

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The locally authored diagnostic glyphs, mirroring the lucide icons the web banner uses for its
 * danger / pre-meta-empty / neutral branches. Each is a monochrome 24×24 stroked vector tinted by the
 * shared `Icon` composable, so it inherits `LocalContentColor` and every theme/state color.
 */
internal object RedisDiagnosticEmptyStateGlyphs {
    /** Two stacked server units with a crack/bolt in the gap (lucide `server-crash`) — danger banners. */
    val ServerCrash: ImageVector =
        diagnosticStroked("RedisDiagnosticServerCrash") {
            rect(3f, 4f, 21f, 9f)
            dot(6.5f, 6.5f)
            rect(3f, 15f, 21f, 20f)
            dot(6.5f, 17.5f)
            moveTo(13f, 9.5f)
            lineTo(11f, 14f)
            lineTo(14f, 14f)
            lineTo(12f, 18.5f)
        }

    /** A storage cylinder (lucide `database`) — the pre-meta legacy empty state. */
    val Database: ImageVector =
        diagnosticStroked("RedisDiagnosticDatabase") {
            moveTo(4f, 6f)
            curveTo(4f, 4.3f, 7.6f, 3f, 12f, 3f)
            curveTo(16.4f, 3f, 20f, 4.3f, 20f, 6f)
            curveTo(20f, 7.7f, 16.4f, 9f, 12f, 9f)
            curveTo(7.6f, 9f, 4f, 7.7f, 4f, 6f)
            close()
            moveTo(4f, 6f)
            lineTo(4f, 18f)
            curveTo(4f, 19.7f, 7.6f, 21f, 12f, 21f)
            curveTo(16.4f, 21f, 20f, 19.7f, 20f, 18f)
            lineTo(20f, 6f)
            moveTo(4f, 12f)
            curveTo(4f, 13.7f, 7.6f, 15f, 12f, 15f)
            curveTo(16.4f, 15f, 20f, 13.7f, 20f, 12f)
        }

    /** Broadcast waves around a center dot (lucide `radio`) — the neutral fall-through banner. */
    val Radio: ImageVector =
        diagnosticStroked("RedisDiagnosticRadio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveToRelative(-2.3f, -2.3f, -2.3f, -6.1f, 0f, -8.5f)
            moveTo(14f, 12f)
            arcToRelative(2f, 2f, 0f, true, true, -4f, 0f)
            arcToRelative(2f, 2f, 0f, true, true, 4f, 0f)
            close()
            moveTo(16.2f, 7.8f)
            curveToRelative(2.3f, 2.3f, 2.3f, 6.1f, 0f, 8.5f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.1f, 19.1f, 19f)
        }
}

private fun diagnosticStroked(
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
