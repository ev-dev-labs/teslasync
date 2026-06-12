// The native Jetpack Compose + Material 3 render layer for the `helpers` feature view — a parity port of the
// web status helpers module (web/src/features/system/components/status/helpers.tsx). The web module is pure
// functions returning a hex color, a Tailwind text class, a lucide icon, and a badge variant; this file is
// the thin Android-idiomatic equivalent. Every classification flows through the pure [StatusKind] in
// HelpersModel.kt; this layer only maps a bucket onto P1/S9 design tokens, a glyph, and a Material badge
// variant, and renders the one piece of the source that returns UI — the status icon.
//
// Web → native token mapping (no ported Tailwind, ADR-005): the web `getStatusColor` hex and the
// `statusTextClass` Tailwind class describe the SAME semantic color, so they collapse into the single
// [statusColor] — success/warning/danger map onto `TeslaTokens.status` (whose values are the web
// `#10b981` / `#f59e0b` / `#ef4444` palette) and the neutral fall-through maps onto the muted
// `onSurfaceVariant` (the web `--text-muted`). The web `getStatusIcon` maps onto [StatusIcon]: a 16dp
// (web `h-4 w-4`) `Icon` tinted by [statusColor], using the shared CheckCircle / AlertTriangle glyphs and a
// locally-authored XCircle (lucide ships no Android glyph, mirroring the sibling StatusHeader's authored
// Inbox). The web `statusToBadgeVariant` maps onto [statusBadgeVariant].
//
// The icon is decorative by default (web renders it with no aria-label beside its own status text), so the
// default `contentDescription` is null and it is skipped by accessibility services; callers that render it
// without adjacent text pass a description to label it. The one-shot `view.opened` diagnostic (P1/S11) is
// emitted on first composition of the stateful [StatusIcon].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/helpers) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.helpers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the native analogue of the web `getStatusIcon(status)`. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11) and renders the status icon for [status].
 *
 * @param status the raw status string (web `status`); classified via the pure [StatusKind.fromStatus].
 * @param contentDescription accessibility label; `null` (the default) marks the icon decorative — faithful
 *   to the web icon, which carries no label beside its adjacent status text.
 * @param size the icon size; defaults to [IconSize.Md] (16dp), the web `h-4 w-4`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StatusIcon(
    status: String?,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    size: IconSize = IconSize.Md,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HelpersDiagnostics.recordViewOpened(logger) }
    StatusIconContent(
        status = status,
        modifier = modifier,
        contentDescription = contentDescription,
        size = size,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Resolves [status] to its [StatusKind] and
 * renders the matching glyph tinted by [statusColor], with no diagnostic side effect.
 */
@Composable
fun StatusIconContent(
    status: String?,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    size: IconSize = IconSize.Md,
) {
    val kind = remember(status) { StatusKind.fromStatus(status) }
    Icon(
        imageVector = statusGlyph(kind),
        contentDescription = contentDescription,
        modifier = modifier,
        size = size,
        tint = statusColor(kind),
    )
}

/**
 * The render color for a [StatusKind] — the native collapse of the web `getStatusColor` (hex) and
 * `statusTextClass` (Tailwind class), which both describe the same semantic color. Success/warning/danger
 * resolve to the per-theme `TeslaTokens.status` palette; the neutral fall-through resolves to the muted
 * `onSurfaceVariant` (the web `--text-muted`).
 */
@Composable
fun statusColor(kind: StatusKind): Color =
    when (kind) {
        StatusKind.Success -> TeslaTokens.status.success
        StatusKind.Warning -> TeslaTokens.status.warning
        StatusKind.Danger -> TeslaTokens.status.danger
        StatusKind.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The Material badge variant for a raw [status] — the native analogue of the web `statusToBadgeVariant`.
 * Routes through the pure [StatusKind.forBadge], so a `connected` status maps to [BadgeVariant.Neutral] here
 * even though it maps to a green color/icon elsewhere (the faithful web asymmetry).
 */
fun statusBadgeVariant(status: String?): BadgeVariant =
    when (StatusKind.forBadge(status)) {
        StatusKind.Success -> BadgeVariant.Success
        StatusKind.Warning -> BadgeVariant.Warning
        StatusKind.Danger -> BadgeVariant.Danger
        StatusKind.Neutral -> BadgeVariant.Neutral
    }

/**
 * The glyph for a [StatusKind] — the native analogue of the web `getStatusIcon`: success → CheckCircle,
 * warning → AlertTriangle, danger → XCircle, and the neutral fall-through → AlertTriangle (the web default
 * branch). CheckCircle and AlertTriangle are reused from the shared set; XCircle is authored below.
 */
private fun statusGlyph(kind: StatusKind): ImageVector =
    when (kind) {
        StatusKind.Success -> DataDisplayGlyphs.CheckCircle
        StatusKind.Warning -> DataDisplayGlyphs.AlertTriangle
        StatusKind.Danger -> HelpersGlyphs.XCircle
        StatusKind.Neutral -> DataDisplayGlyphs.AlertTriangle
    }

/**
 * The one glyph this surface needs that the shared sets do not carry. The web danger icon is lucide
 * `XCircle`; Android ships no equivalent without the frozen `material-icons-extended` artifact, so — exactly
 * as the sibling `StatusHeaderGlyphs` does for its lucide port — it is authored here as a 24×24 stroked
 * vector (a ring with a centered cross).
 */
private object HelpersGlyphs {
    private const val VIEWPORT = 24f
    private const val STROKE_WIDTH = 2f
    private const val CENTER = 12f
    private const val RING_RADIUS = 9f
    private const val CROSS_NEAR = 9f
    private const val CROSS_FAR = 15f

    val XCircle: ImageVector =
        stroked("XCircle") {
            circle(CENTER, CENTER, RING_RADIUS)
            moveTo(CROSS_NEAR, CROSS_NEAR)
            lineTo(CROSS_FAR, CROSS_FAR)
            moveTo(CROSS_FAR, CROSS_NEAR)
            lineTo(CROSS_NEAR, CROSS_FAR)
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
                viewportWidth = VIEWPORT,
                viewportHeight = VIEWPORT,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = STROKE_WIDTH,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()

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
}

// ── Previews (tooling-only; one @Preview per status bucket the source defines + an all-states row) ──────

@Preview(name = "Success (healthy)", showBackground = true)
@Composable
private fun StatusIconSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusIconContent(status = "healthy")
    }
}

@Preview(name = "Warning (degraded)", showBackground = true)
@Composable
private fun StatusIconWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusIconContent(status = "degraded")
    }
}

@Preview(name = "Danger (error)", showBackground = true)
@Composable
private fun StatusIconDangerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusIconContent(status = "error")
    }
}

@Preview(name = "Neutral (unknown)", showBackground = true)
@Composable
private fun StatusIconNeutralPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusIconContent(status = "syncing")
    }
}

@Preview(name = "All buckets", showBackground = true)
@Composable
private fun StatusIconAllPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatusIconContent(status = "online")
            StatusIconContent(status = "pending")
            StatusIconContent(status = "failed")
            StatusIconContent(status = "unknown")
        }
    }
}
