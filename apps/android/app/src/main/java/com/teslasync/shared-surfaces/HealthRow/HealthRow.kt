// The native Jetpack Compose + Material 3 HealthRow shared surface — a parity port of
// web/src/components/status/HealthRow.tsx. The web surface is a single-line health-summary row: a
// status-coloured dot, an optional leading icon, a truncated label, a right-aligned status-coloured summary
// (e.g. "12 / 12 healthy"), and — only when the row is a link or has an onClick — a trailing chevron. Stacks of
// these inside a panel form a high-density at-a-glance health grid. It is pure presentational — the parent owns
// the status, the already-formatted strings, and the click target, and the component has no data hook.
//
// Every colour / click / role decision flows through the pure model in HealthRowModel.kt (projectHealthRow →
// [HealthRowProjection]; healthRowInteraction → [HealthRowInteraction]); this composable is a thin render layer
// that maps the projected [HealthRowTone] onto the per-theme TeslaTokens palette (P1/S9), wires the clickable
// from the resolved interaction, and fires the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first
// composition. It performs NO HTTP. The `HeroStatus` type is reused from the sibling StatusHero surface, exactly
// as the web imports `HeroStatus` from `./StatusHero`.
//
// Faithful mapping of the web behaviour:
//   • the web `DOT_FOR_STATUS[status]` dot fill + `TEXT_FOR_STATUS[status]` summary colour (identical tables) →
//     the single [healthRowToneColor] applied to both the dot and the summary text;
//   • the web `h-2.5 w-2.5 rounded-full` dot → a 10 dp circle filled with the tone ([StatusDot], decorative);
//   • the web optional `text-[var(--text-secondary)]` icon span → the caller's [icon] slot rendered with
//     `LocalContentColor` set to the muted on-surface colour, so a shared `Icon` inherits the secondary tone;
//   • the web `flex-1 truncate text-sm font-medium text-[var(--text-primary)]` label → a weighted, single-line
//     ellipsised `Text` in the primary on-surface colour;
//   • the web `text-xs {summaryClass}` summary → a small `Text` in the tone colour, never truncated (shrink-0);
//   • the web `(to || onClick) && <ChevronRight … text-[var(--text-muted)] />` → the shared `ChevronRight` glyph
//     in the muted colour, rendered only for an interactive row ([healthRowShowsAffordance]);
//   • the web render split `to ? (external ? <a target=_blank> : <Link>) : (onClick ? <button> : <div>)` →
//     [healthRowInteraction]: an external link opens via the Compose `LocalUriHandler`, an internal link routes
//     through the host's [onNavigate] (the NavController — the web router `<Link>`), a clickable fires [onClick],
//     and a static row exposes no click action;
//   • the web `min-h-[44px]` + `hover:bg / focus-visible:ring` interactive affordance → a 44 dp min-height
//     (also the accessibility touch-target floor) and the Material clickable ripple (touch has no hover).
//
// Accessibility: an interactive row is one merged TalkBack node exposed as a Button (so its dot-less label +
// summary are read as one actionable element and the activate gesture is offered — the native analogue of the
// web link's `aria-label={`${label} — ${summary}`}`); a host may override the spoken name with
// [contentDescription]. A static row is not merged, so the label and summary are read as their own text, exactly
// as the web `<div>` has no `aria-label`. The dot, the icon, and the chevron are decorative (web `aria-hidden`).
// The surface owns no copy, so there are no English literals here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/HealthRow) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers,
// and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.healthrow

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.statushero.HeroStatus
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag for the row body — lets a UI test find, activate, and assert the row. */
const val HEALTH_ROW_ROOT_TAG: String = "health-row-root"

/** Test tag for the status dot — lets a UI test assert the coloured status indicator is present. */
const val HEALTH_ROW_DOT_TAG: String = "health-row-dot"

/** Test tag for the trailing chevron — lets a UI test assert the interactive-only affordance. */
const val HEALTH_ROW_CHEVRON_TAG: String = "health-row-chevron"

/** The status dot diameter — the native mirror of the web `h-2.5 w-2.5` (10 px) circle. */
private val DOT_SIZE: Dp = 10.dp

/** Minimum row height — the native mirror of the web `min-h-[44px]`, also the a11y touch-target floor. */
private val ROW_MIN_HEIGHT: Dp = 44.dp

/**
 * Stateful entry point — the faithful port of `<HealthRow status={…} label={…} summary={…} … />`. Records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11), resolves the browser opener for an external link, and
 * renders the row. Always renders (the web component never returns `null`). Performs no HTTP. For a parent that
 * renders many rows in a health grid and does not want a per-row diagnostic, [HealthRowContent] is the
 * diagnostics-free render seam.
 *
 * @param status the health tier driving the dot + summary colour (web `status`).
 * @param label the truncated, primary line (web `label`) — a caller-supplied, already-localized string.
 * @param summary the right-aligned status-coloured summary (web `summary`) — already-localized.
 * @param icon optional leading icon slot (web `icon`), rendered in the muted secondary colour.
 * @param to optional link target (web `to`); null / blank means the row is not a link.
 * @param external whether a present [to] opens in the browser (web `external`, the `<a target="_blank">`).
 * @param onClick tap handler used when no [to] is set (web `onClick`).
 * @param onNavigate host navigator invoked with an internal [to] when tapped (the web router `<Link>`).
 * @param onOpenExternal opener invoked with an external [to]; defaults to the Compose `LocalUriHandler`.
 * @param contentDescription optional explicit accessible name for the interactive row; defaults to the row's
 *   merged label + summary text (the web link's `aria-label`).
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through.
 */
@Composable
fun HealthRow(
    status: HeroStatus,
    label: String,
    summary: String,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    to: String? = null,
    external: Boolean = false,
    onClick: (() -> Unit)? = null,
    onNavigate: (String) -> Unit = {},
    onOpenExternal: ((String) -> Unit)? = null,
    contentDescription: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HealthRowDiagnostics.recordViewOpened(logger) }
    val uriHandler = LocalUriHandler.current
    val openExternal = onOpenExternal ?: { url -> uriHandler.openUri(url) }
    HealthRowContent(
        status = status,
        label = label,
        summary = summary,
        modifier = modifier,
        icon = icon,
        to = to,
        external = external,
        onClick = onClick,
        onNavigate = onNavigate,
        onOpenExternal = openExternal,
        contentDescription = contentDescription,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point, and the grid-friendly
 * seam (it emits no diagnostics, so a parent rendering many rows never fires a per-row `view.opened`, and it
 * never touches [LocalDataContainer]). Reduces the click props to a [HealthRowInteraction], resolves the tone
 * colour, lays out the dot + optional icon + label + summary + interactive-only chevron in one row, and wires
 * the clickable from the resolved interaction.
 */
@Composable
fun HealthRowContent(
    status: HeroStatus,
    label: String,
    summary: String,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    to: String? = null,
    external: Boolean = false,
    onClick: (() -> Unit)? = null,
    onNavigate: (String) -> Unit = {},
    onOpenExternal: (String) -> Unit = {},
    contentDescription: String? = null,
) {
    val interaction = remember(to, external, onClick) { healthRowInteraction(to, external, onClick != null) }
    val tone = healthRowToneColor(remember(status) { projectHealthRow(status) }.tone)
    val onTap: (() -> Unit)? =
        when (interaction) {
            is HealthRowInteraction.OpenExternal -> {
                { onOpenExternal(interaction.url) }
            }
            is HealthRowInteraction.Navigate -> {
                { onNavigate(interaction.to) }
            }
            HealthRowInteraction.Clickable -> onClick
            HealthRowInteraction.Static -> null
        }

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .rowInteraction(onTap = onTap, contentDescription = contentDescription)
                .heightIn(min = ROW_MIN_HEIGHT)
                .padding(horizontal = Spacing.md, vertical = Spacing.md)
                .testTag(HEALTH_ROW_ROOT_TAG),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatusDot(tone)
        if (icon != null) {
            // Web `text-[var(--text-secondary)]` icon span: the slot inherits the muted secondary colour, and a
            // caller-supplied decorative `Icon` (contentDescription = null) tints itself from LocalContentColor.
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
                icon()
            }
        }
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = summary,
            style = MaterialTheme.typography.bodySmall,
            color = tone,
            maxLines = 1,
        )
        if (healthRowShowsAffordance(interaction)) {
            // Decorative (web `aria-hidden`): the chevron only signals the row is actionable.
            Icon(
                imageVector = TeslaGlyphs.ChevronRight,
                contentDescription = null,
                modifier = Modifier.testTag(HEALTH_ROW_CHEVRON_TAG),
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Apply the row's click + accessibility wiring: the clickable (with the [Role.Button] role) when [onTap] is
 * non-null — the native analogue of the web `<a>` / `<Link>` / `<button>` — then a semantics node that merges
 * the label + summary into one TalkBack element for an interactive row (the web link's `aria-label`) and carries
 * the optional explicit [contentDescription]. A static row gets neither, so its label + summary are read as
 * their own text, exactly as the web `<div>` exposes no `aria-label`.
 */
private fun Modifier.rowInteraction(
    onTap: (() -> Unit)?,
    contentDescription: String?,
): Modifier {
    var result = this
    if (onTap != null) {
        result = result.clickable(role = Role.Button, onClick = onTap)
    }
    if (onTap != null || contentDescription != null) {
        result =
            result.semantics(mergeDescendants = onTap != null) {
                if (contentDescription != null) this.contentDescription = contentDescription
            }
    }
    return result
}

/** The tinted status dot — the web `h-2.5 w-2.5 rounded-full {dotClass}` circle. Decorative (web `aria-hidden`). */
@Composable
private fun StatusDot(tone: Color) {
    Box(
        modifier =
            Modifier
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(tone)
                .testTag(HEALTH_ROW_DOT_TAG),
    )
}

/**
 * Map the projected [HealthRowTone] onto a per-theme colour — the native mirror of the web `DOT_FOR_STATUS` /
 * `TEXT_FOR_STATUS` families, drawn from the TeslaTokens status palette (and the Material scheme's muted colour
 * for the neutral `unknown` tier) so light / dark / high-contrast all stay correct.
 */
@Composable
@ReadOnlyComposable
private fun healthRowToneColor(tone: HealthRowTone): Color =
    when (tone) {
        HealthRowTone.Success -> TeslaTokens.status.success
        HealthRowTone.Warning -> TeslaTokens.status.warning
        HealthRowTone.Danger -> TeslaTokens.status.danger
        HealthRowTone.Info -> TeslaTokens.status.info
        HealthRowTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

// ── Previews (tooling-only; sample labels / summaries are never shipped UI) ─────────────────────────────────

@Composable
private fun PreviewHealthRow(
    status: HeroStatus,
    label: String,
    summary: String,
    icon: (@Composable () -> Unit)? = null,
    to: String? = null,
    external: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    GlassPanel {
        HealthRowContent(
            status = status,
            label = label,
            summary = summary,
            icon = icon,
            to = to,
            external = external,
            onClick = onClick,
        )
    }
}

@Composable
private fun PreviewDotIcon() {
    Icon(imageVector = TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Md)
}

@Preview(name = "Healthy — navigable with icon", showBackground = true)
@Composable
private fun HealthRowHealthyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewHealthRow(
            status = HeroStatus.Healthy,
            label = "Vehicles",
            summary = "12 / 12 healthy",
            icon = { PreviewDotIcon() },
            to = "/vehicles",
        )
    }
}

@Preview(name = "Degraded — clickable", showBackground = true)
@Composable
private fun HealthRowDegradedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewHealthRow(
            status = HeroStatus.Degraded,
            label = "Telemetry pipeline",
            summary = "2 streams lagging",
            onClick = {},
        )
    }
}

@Preview(name = "Unhealthy — external link", showBackground = true)
@Composable
private fun HealthRowUnhealthyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewHealthRow(
            status = HeroStatus.Unhealthy,
            label = "MQTT broker",
            summary = "offline",
            to = "https://status.example.com",
            external = true,
        )
    }
}

@Preview(name = "Unknown — static row", showBackground = true)
@Composable
private fun HealthRowUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewHealthRow(
            status = HeroStatus.Unknown,
            label = "Fleet status",
            summary = "0 vehicles · idle",
        )
    }
}

@Preview(name = "Dark — maintenance navigable", showBackground = true)
@Composable
private fun HealthRowMaintenancePreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        PreviewHealthRow(
            status = HeroStatus.Maintenance,
            label = "Scheduled maintenance window",
            summary = "starts in 2h",
            to = "/system/maintenance",
        )
    }
}
