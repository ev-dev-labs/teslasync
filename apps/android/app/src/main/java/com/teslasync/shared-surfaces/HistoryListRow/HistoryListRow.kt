// The native Jetpack Compose + Material 3 HistoryListRow shared surface — a parity port of
// web/src/components/data-display/HistoryListRow.tsx. The web component is a generic, slot-based row for the
// history pages: DriveCard (under /drives) and ChargingSessionCard (under /charging) compose the same row with
// different leading badges, metric chips, and hover actions. Top-down the row carries an optional checkbox (a
// sibling outside the link, so toggling selection never navigates), an optional fixed-width leading badge, the
// required primary line, then optional route / metrics / insight lines, with hover-revealed actions pinned
// top-right and a trailing chevron. It is purely presentational — the parent owns every slot and the click
// target — and has no hook of its own.
//
// Every click/role/accent decision flows through the pure model in HistoryListRowModel.kt; this composable is a
// thin render layer that lays out the slots with the shared GlassPanel, wires the clickable from the resolved
// [HistoryListRowInteraction], maps the resolved accent onto the GlassPanel PanelAccent, and fires the one-shot
// PII-safe `view.opened` diagnostic (P1/S11). It performs NO HTTP.
//
// Native adaptations (documented per Honesty Covenant #9, not silently dropped):
//   • Hover-revealed actions → always visible. The web reveals the action cluster on `group-hover` /
//     `focus-within`; a touch surface has no hover, so the cluster is always shown (the same trade the sibling
//     AnnotationList makes for its hover-revealed remove button). Each action stays a separate focusable touch
//     target — a clickable child is not absorbed by the row's merged semantics — so tapping an action activates
//     the action, not the row (the native analogue of the web `stopPropagation`).
//   • Hover glow → no resting accent. The web `glow` tints the panel only on `:hover`; with no hover on touch
//     an unselected row paints the plain border, and only `selected` shows the persistent ring
//     (PanelAccent.Primary). See [historyListRowAccent].
//   • Navigation. The web wraps the body in a router `<Link to={href}>`; the native row has no router, so a
//     navigable row routes its href through the host-supplied [onNavigate] (the NavController), exactly as the
//     web `<Link>` relies on its router context.
//
// Accessibility: an interactive row is one merged TalkBack node exposed as a Button (so its slot text is read
// as one actionable element and the activate gesture is offered); a host may override the spoken name with
// [contentDescription]. The decorative chevron carries no description. The checkbox and each action remain
// separate focusable targets. The surface owns no copy, so there are no English literals here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/HistoryListRow) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.historylistrow

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag for the clickable panel body — lets a UI test find, activate, and assert the row. */
const val HISTORY_LIST_ROW_PANEL_TAG: String = "history-list-row-panel"

/** Test tag for the trailing chevron — lets a UI test assert the hideChevron state. */
const val HISTORY_LIST_ROW_CHEVRON_TAG: String = "history-list-row-chevron"

/** Web leading column `w-9` (2.25rem = 36 dp) — the fixed, centred width every leading badge aligns within. */
private val LEADING_WIDTH: Dp = 36.dp

/**
 * Stateful entry point — the faithful port of the web `HistoryListRow`. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11), then renders the slot-based row. Performs no HTTP; [logger] defaults to
 * the process logger. For a parent that renders many rows in a list and does not want a per-row diagnostic,
 * [HistoryListRowContent] is the diagnostics-free render seam.
 *
 * @param primary the required primary line (web `primary`) — composed inline by the caller in a [RowScope].
 * @param checkbox optional selection checkbox (web `checkbox`); a sibling outside the clickable, so toggling it
 *   never activates the row.
 * @param leading optional fixed-width leading badge (web `leading`) — score letter, charger icon, progress ring.
 * @param route optional second line (web `route`) — route display, charger location.
 * @param metrics optional third line of metric chips (web `metrics`) — composed in a [RowScope].
 * @param insight optional fourth line (web `insight`) — an inline insight below the metrics.
 * @param actions optional action cluster (web `actions`) pinned top-right; always visible on touch.
 * @param href navigation target (web `href`); routed through [onNavigate] when tapped.
 * @param onClick tap handler (web `onClick`), used when no [href] is set.
 * @param onNavigate host navigator invoked with [href] when a navigable row is tapped (the web router `<Link>`).
 * @param selected whether the row shows the selected ring (web `selected`).
 * @param glow parity hover-glow colour (web `glow`); no resting accent on touch (see [historyListRowAccent]).
 * @param hideChevron hide the trailing chevron when the row is not navigable (web `hideChevron`).
 * @param contentDescription optional explicit accessible name for the interactive row; defaults to the row's
 *   merged slot text.
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through.
 */
@Composable
fun HistoryListRow(
    primary: @Composable RowScope.() -> Unit,
    modifier: Modifier = Modifier,
    checkbox: (@Composable () -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    route: (@Composable () -> Unit)? = null,
    metrics: (@Composable RowScope.() -> Unit)? = null,
    insight: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    href: String? = null,
    onClick: (() -> Unit)? = null,
    onNavigate: (String) -> Unit = {},
    selected: Boolean = false,
    glow: HistoryListRowGlow = HistoryListRowGlow.Cyan,
    hideChevron: Boolean = false,
    contentDescription: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HistoryListRowDiagnostics.recordViewOpened(logger) }
    HistoryListRowContent(
        primary = primary,
        modifier = modifier,
        checkbox = checkbox,
        leading = leading,
        route = route,
        metrics = metrics,
        insight = insight,
        actions = actions,
        href = href,
        onClick = onClick,
        onNavigate = onNavigate,
        selected = selected,
        glow = glow,
        hideChevron = hideChevron,
        contentDescription = contentDescription,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point, and the list-friendly
 * seam (it emits no diagnostics, so a parent rendering many rows never fires a per-row `view.opened`). Reduces
 * the click props to a [HistoryListRowInteraction] and the `(selected, glow)` pair to a [HistoryListRowAccent],
 * lays the checkbox outside the clickable body, and composes the slot stack inside the shared GlassPanel.
 */
@Composable
fun HistoryListRowContent(
    primary: @Composable RowScope.() -> Unit,
    modifier: Modifier = Modifier,
    checkbox: (@Composable () -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    route: (@Composable () -> Unit)? = null,
    metrics: (@Composable RowScope.() -> Unit)? = null,
    insight: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    href: String? = null,
    onClick: (() -> Unit)? = null,
    onNavigate: (String) -> Unit = {},
    selected: Boolean = false,
    glow: HistoryListRowGlow = HistoryListRowGlow.Cyan,
    hideChevron: Boolean = false,
    contentDescription: String? = null,
) {
    val interaction = remember(href, onClick) { historyListRowInteraction(href, onClick != null) }
    val accent = historyListRowAccent(selected, glow)
    val onTap: (() -> Unit)? =
        when (interaction) {
            is HistoryListRowInteraction.Navigate -> {
                { onNavigate(interaction.href) }
            }
            HistoryListRowInteraction.Clickable -> onClick
            HistoryListRowInteraction.Static -> null
        }

    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (checkbox != null) {
            Box(
                modifier = Modifier.padding(start = Spacing.sm),
                contentAlignment = Alignment.Center,
                content = { checkbox() },
            )
        }
        GlassPanel(
            modifier =
                Modifier
                    .weight(1f)
                    .rowInteraction(onTap = onTap, selected = selected, contentDescription = contentDescription)
                    .testTag(HISTORY_LIST_ROW_PANEL_TAG),
            padding = PanelPadding.Md,
            accent = panelAccent(accent),
        ) {
            Box(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    if (leading != null) {
                        Box(
                            modifier = Modifier.width(LEADING_WIDTH),
                            contentAlignment = Alignment.Center,
                            content = { leading() },
                        )
                    }
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                            content = primary,
                        )
                        if (route != null) route()
                        if (metrics != null) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                                content = metrics,
                            )
                        }
                        if (insight != null) insight()
                    }
                    if (!hideChevron) {
                        Icon(
                            TeslaGlyphs.ChevronRight,
                            contentDescription = null,
                            modifier = Modifier.testTag(HISTORY_LIST_ROW_CHEVRON_TAG),
                            size = IconSize.Sm,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (actions != null) {
                    Row(
                        modifier = Modifier.align(Alignment.TopEnd),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                        content = actions,
                    )
                }
            }
        }
    }
}

/**
 * Apply the row's click + accessibility wiring: the clickable (with the [HistoryListRowRole.Button] role) when
 * [onTap] is non-null, then a semantics node that merges the slot text into one TalkBack element for an
 * interactive row, carries the optional explicit [contentDescription], and marks the [selected] state.
 */
private fun Modifier.rowInteraction(
    onTap: (() -> Unit)?,
    selected: Boolean,
    contentDescription: String?,
): Modifier {
    val interactive = onTap != null
    var result = this
    if (onTap != null) {
        result = result.clickable(role = Role.Button, onClick = onTap)
    }
    if (interactive || selected || contentDescription != null) {
        result =
            result.semantics(mergeDescendants = interactive) {
                if (contentDescription != null) this.contentDescription = contentDescription
                if (selected) this.selected = true
            }
    }
    return result
}

/** Map the resolved [HistoryListRowAccent] onto the shared GlassPanel border accent. */
private fun panelAccent(accent: HistoryListRowAccent): PanelAccent =
    when (accent) {
        HistoryListRowAccent.Selected -> PanelAccent.Primary
        HistoryListRowAccent.None -> PanelAccent.None
    }

// ── Previews (tooling-only; sample slot content is never shipped UI) ──────────────────────────────────────

@Preview(name = "Navigable — full slots", showBackground = true)
@Composable
private fun HistoryListRowFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HistoryListRowContent(
            primary = { Text("3:42 PM") },
            leading = { Text("A") },
            route = { Text("Home \u2192 Office") },
            metrics = { Text("avg 29 mph \u00B7 \u22121%") },
            insight = { Text("\u26A0 Low efficiency") },
            href = "/drives/1",
        )
    }
}

@Preview(name = "Selected + actions + checkbox", showBackground = true)
@Composable
private fun HistoryListRowSelectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HistoryListRowContent(
            primary = { Text("9:10 AM") },
            checkbox = { Text("\u2610") },
            leading = { Text("B") },
            actions = { Text("\uD83D\uDC41") },
            selected = true,
            onClick = {},
        )
    }
}

@Preview(name = "Static — no chevron", showBackground = true)
@Composable
private fun HistoryListRowStaticPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        HistoryListRowContent(
            primary = { Text("Idle session") },
            hideChevron = true,
            glow = HistoryListRowGlow.None,
        )
    }
}
