// The native Jetpack Compose + Material 3 NotionSidebar shared surface — a parity port of
// web/src/components/layout/sidebar/NotionSidebar.tsx. The web component is a Notion-style navigation tree: a
// quiet Favorites group (shown when there are pins), a Pages group of collapsible sections each with a
// caret + glyph + count, indented leaf rows that highlight the active route, hover-revealed pin/unpin
// affordances, trailing alert/vehicle/stale badges, and an inline "No matches." filter-empty branch.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the only live data seam —
// the current route (the web `useLocation()`, P1/S8) — through the [NotionSidebarViewModel]; the sidebar's
// other inputs (sections, pinned items, counts, the pin/unpin/select callbacks) are host-owned props passed
// straight in, exactly as the web component receives them. The composable is a thin render layer that resolves
// the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the pure [NotionSidebarProjection] returns,
// using the shared component library (ui Button/Icon/IconButton/typography, TeslaGlyphs). It renders every
// branch the web source draws without ever hiding a surface: the Favorites + Pages tree, each section expanded
// or collapsed, the active row, the trailing badges, and the filter-empty "No matches." + "Clear filter"
// branch — all reachable through [NotionSidebarContent], the stateless renderer the previews and the UI test
// drive per state. The one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// Hover-only affordances do not exist on touch, so the per-row pin/unpin control is always shown (and always
// labelled) rather than hover-gated — the accessible native idiom, faithful to the web action's intent. Like
// the web source, the inline filter exposes only a "Clear" action (the web component renders no filter input of
// its own); the filtered / no-match branches are still fully reproduced by the projection and rendered by
// [NotionSidebarContent], exercised by the previews + UI test.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/NotionSidebar) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.notionsidebar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the rendered sidebar in any state. */
const val NOTION_SIDEBAR_TEST_TAG: String = "notion-sidebar"

/** Test tag on the inline filter-empty branch (web `data-testid="notion-sidebar-empty-filter"`). */
const val NOTION_SIDEBAR_EMPTY_TEST_TAG: String = "notion-sidebar-empty-filter"

/** Per-section test tag so a UI test can target a section header regardless of its localized title. */
fun notionSectionTestTag(title: String): String = "notion-section-$title"

/** Per-row test tag so a UI test can target an entry by its route regardless of its localized label. */
fun notionRowTestTag(to: String): String = "notion-row-$to"

private const val ACTIVE_ROW_ALPHA = 0.08f
private val NOTION_DOT_SIZE = 6.dp

/** Indent depth for a row, mirroring the web `ps-2` (favorites) vs `ps-7` (nested page) padding. */
private enum class NotionIndent(
    val start: Dp,
) {
    Favorite(Spacing.sm),
    Page(Spacing.xl2),
}

/**
 * Stateful entry point bound to the router state-holder — the faithful port of the web `NotionSidebar` reading
 * `useLocation()`. Binds the [NotionSidebarViewModel], records the one-shot `view.opened` diagnostic (P1/S11),
 * collects the current route path, owns the local filter + collapsed tree state, projects everything together
 * with the host-owned [input], and renders.
 *
 * @param viewModel the state holder bound to the shared router-state-holder seam ([NotionSidebarSource]).
 * @param input the host-owned sidebar inputs (sections, pinned items, counts) — the web props.
 * @param onItemSelect invoked with the tapped entry's route; the host navigates there and applies its
 *   drawer-close policy (web `<GuardedNavLink to>` + `onItemSelect`).
 * @param onPin invoked with a route to pin to Favorites (web `onPin`).
 * @param onUnpin invoked with a route to remove from Favorites (web `onUnpin`).
 * @param modifier optional layout modifier for the sidebar container.
 */
@Composable
fun NotionSidebar(
    viewModel: NotionSidebarViewModel,
    input: NotionSidebarInput,
    onItemSelect: (String) -> Unit,
    onPin: (String) -> Unit,
    onUnpin: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val currentPath by viewModel.currentPath.collectAsStateWithLifecycle()
    NotionSidebarStateful(
        currentPath = currentPath,
        input = input,
        onItemSelect = onItemSelect,
        onPin = onPin,
        onUnpin = onUnpin,
        modifier = modifier,
    )
}

/**
 * Stateful entry point driven directly by the owning scaffold's current route — the convenience overload a
 * navigation shell uses when it already holds the live path (from `currentBackStackEntryAsState`), mirroring
 * the sibling BottomTabBar's path-driven overload. Records the one-shot `view.opened` diagnostic, owns the
 * local tree state, projects, and renders; no ViewModel instance is required.
 *
 * @param input the host-owned sidebar inputs (sections, pinned items, counts) — the web props.
 * @param currentPath the current route path (web `useLocation().pathname`).
 * @param onItemSelect invoked with the tapped entry's route; the host navigates there.
 * @param onPin invoked with a route to pin to Favorites.
 * @param onUnpin invoked with a route to remove from Favorites.
 * @param modifier optional layout modifier for the sidebar container.
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun NotionSidebar(
    input: NotionSidebarInput,
    currentPath: String,
    onItemSelect: (String) -> Unit,
    onPin: (String) -> Unit,
    onUnpin: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { NotionSidebarDiagnostics.recordViewOpened(logger) }
    NotionSidebarStateful(
        currentPath = currentPath,
        input = input,
        onItemSelect = onItemSelect,
        onPin = onPin,
        onUnpin = onUnpin,
        modifier = modifier,
    )
}

/**
 * Owns the surface's local UI state — the inline filter needle and the collapsed-section set — exactly like the
 * web component's two `useState` hooks. The collapsed set is initialized once to every section except the
 * active one (web `useState` initializer) and survives configuration changes; a side-effect un-collapses the
 * active section whenever it changes (web `useEffect`). Everything is folded through the pure projection.
 */
@Composable
private fun NotionSidebarStateful(
    currentPath: String,
    input: NotionSidebarInput,
    onItemSelect: (String) -> Unit,
    onPin: (String) -> Unit,
    onUnpin: (String) -> Unit,
    modifier: Modifier,
) {
    var filter by rememberSaveable { mutableStateOf("") }
    var collapsed by rememberSaveable(stateSaver = CollapsedStateSaver) {
        mutableStateOf(NotionSidebarProjection.initialCollapsed(input))
    }
    LaunchedEffect(input.activeSectionTitle) {
        val active = input.activeSectionTitle
        if (active != null && active in collapsed) collapsed = collapsed - active
    }

    val strings = rememberNotionSidebarStrings()
    val display =
        remember(input, currentPath, filter, collapsed, strings) {
            NotionSidebarProjection.project(input, currentPath, filter, collapsed, strings)
        }
    NotionSidebarContent(
        display = display,
        modifier = modifier,
        onItemSelect = onItemSelect,
        onPin = onPin,
        onUnpin = onUnpin,
        onToggleSection = { title -> collapsed = if (title in collapsed) collapsed - title else collapsed + title },
        onClearFilter = { filter = "" },
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the full Notion tree from a fully
 * resolved [display]: the Favorites group (when there are pins), the Pages group with every section header +
 * its rows when expanded, the active-row highlight, the trailing badges, and the inline "No matches." branch
 * with its "Clear filter" action. Every section and the surface landmark carry their accessible names, and
 * every interactive element (each row, each pin/unpin control, the clear action) is individually labelled.
 */
@Composable
fun NotionSidebarContent(
    display: NotionSidebarDisplay,
    modifier: Modifier = Modifier,
    onItemSelect: (String) -> Unit = {},
    onPin: (String) -> Unit = {},
    onUnpin: (String) -> Unit = {},
    onToggleSection: (String) -> Unit = {},
    onClearFilter: () -> Unit = {},
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(NOTION_SIDEBAR_TEST_TAG)
                .semantics { contentDescription = display.navLabel }
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.xs, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.none),
    ) {
        if (display.showFavorites) {
            NotionGroupLabel(display.favoritesLabel)
            display.favorites.forEach { row ->
                NotionNavRow(
                    row = row,
                    indent = NotionIndent.Favorite,
                    onItemSelect = onItemSelect,
                    onPin = onPin,
                    onUnpin = onUnpin,
                )
            }
        }

        NotionGroupLabel(display.pagesLabel)
        display.sections.forEach { section ->
            NotionSectionRow(section = section, onToggle = { onToggleSection(section.title) })
            if (section.expanded) {
                section.items.forEach { row ->
                    NotionNavRow(
                        row = row,
                        indent = NotionIndent.Page,
                        onItemSelect = onItemSelect,
                        onPin = onPin,
                        onUnpin = onUnpin,
                    )
                }
            }
        }

        if (display.showNoResults) {
            NotionNoMatches(
                message = display.filterNoMatchLabel,
                clearLabel = display.filterClearLabel,
                onClear = onClearFilter,
            )
        }
    }
}

/** A small, muted group header (web `GroupLabel`) — sentence case, never shouting, just like Notion. */
@Composable
private fun NotionGroupLabel(text: String) {
    Caption(
        text = text,
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.sm, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
    )
}

/** One section header (web `NotionSectionRow`): caret + borrowed glyph + title + filtered count; toggles. */
@Composable
private fun NotionSectionRow(
    section: NotionSectionDisplay,
    onToggle: () -> Unit,
) {
    val toggleLabel =
        stringResource(
            if (section.expanded) {
                R.string.translation_automations_presets_collapse
            } else {
                R.string.translation_automations_presets_expand
            },
        )
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .clickable(onClickLabel = toggleLabel, onClick = onToggle)
                .testTag(notionSectionTestTag(section.title))
                .padding(horizontal = Spacing.xs, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = if (section.expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Icon(
            imageVector = section.icon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = section.iconColor ?: MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BodyText(section.title, modifier = Modifier.weight(1f), maxLines = 1)
        Caption(section.count.toString())
    }
}

/** One leaf entry (web `NotionRow` + its hover action): the navigable line plus an always-shown pin/unpin. */
@Composable
private fun NotionNavRow(
    row: NotionRowDisplay,
    indent: NotionIndent,
    onItemSelect: (String) -> Unit,
    onPin: (String) -> Unit,
    onUnpin: (String) -> Unit,
) {
    val rowBackground =
        if (row.active) MaterialTheme.colorScheme.onSurface.copy(alpha = ACTIVE_ROW_ALPHA) else Color.Transparent
    val labelColor =
        if (row.active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    val iconTint =
        when {
            row.active -> MaterialTheme.colorScheme.onSurface
            else -> row.iconColor ?: MaterialTheme.colorScheme.onSurfaceVariant
        }
    val pinLabel = stringResource(R.string.translation_nav_pinPage, row.label)
    val unpinLabel = stringResource(R.string.translation_nav_unpinPage, row.label)

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier =
                Modifier
                    .weight(1f)
                    .clip(MaterialTheme.shapes.small)
                    .background(rowBackground)
                    .clickable(onClickLabel = row.label) { onItemSelect(row.to) }
                    .testTag(notionRowTestTag(row.to))
                    .semantics { selected = row.active }
                    .padding(start = indent.start, end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(imageVector = row.icon, contentDescription = null, size = IconSize.Sm, tint = iconTint)
            BodyText(row.label, modifier = Modifier.weight(1f), color = labelColor, maxLines = 1)
            row.trailing?.let { NotionTrailing(it) }
        }
        if (row.pinned) {
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = unpinLabel,
                onClick = { onUnpin(row.to) },
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            IconButton(
                imageVector = TeslaGlyphs.Pin,
                contentDescription = pinLabel,
                onClick = { onPin(row.to) },
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The trailing badge for a row — a decorative dot (web `NotificationDot`) or a labelled count chip. */
@Composable
private fun NotionTrailing(badge: NotionTrailingBadge) {
    when (badge) {
        is NotionTrailingBadge.Dot ->
            Box(
                modifier =
                    Modifier
                        .size(NOTION_DOT_SIZE)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
            )

        is NotionTrailingBadge.Count -> {
            val label =
                when (badge.kind) {
                    NotionCountKind.Vehicles -> stringResource(R.string.translation_nav_vehicleCount, badge.value)
                    NotionCountKind.Stale -> stringResource(R.string.translation_nav_staleCount, badge.value)
                }
            Box(
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(Radius.sm))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clearAndSetSemantics { contentDescription = label }
                        .padding(horizontal = Spacing.xs, vertical = Spacing.none),
                contentAlignment = Alignment.Center,
            ) {
                Caption(badge.displayText)
            }
        }
    }
}

/** The inline filter-empty branch (web `showNoResults`): a status message plus a "Clear filter" action. */
@Composable
private fun NotionNoMatches(
    message: String,
    clearLabel: String,
    onClear: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(NOTION_SIDEBAR_EMPTY_TEST_TAG)
                .semantics { liveRegion = LiveRegionMode.Polite }
                .padding(horizontal = Spacing.md, vertical = Spacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        BodyText(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(label = clearLabel, onClick = onClear, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
    }
}

/** Builds the localized chrome labels from the P1/S10 catalog using the web component's exact i18n keys. */
@Composable
private fun rememberNotionSidebarStrings(): NotionSidebarStrings =
    NotionSidebarStrings(
        navLabel = stringResource(R.string.translation_nav_sidebar),
        favorites = stringResource(R.string.translation_nav_favorites),
        pages = stringResource(R.string.translation_nav_pages),
        filterNoMatch = stringResource(R.string.translation_nav_filterNoMatch),
        filterClear = stringResource(R.string.translation_nav_filterClear),
    )

/** Saves the collapsed-section set across configuration changes as a Bundle-serializable list of titles. */
private val CollapsedStateSaver: Saver<Set<String>, ArrayList<String>> =
    Saver(
        save = { ArrayList(it) },
        restore = { it.toSet() },
    )

// ── Previews — one per rendered branch (favorites + pages, collapsed, badges, no-match, no favorites). ───────

private fun previewStrings(): NotionSidebarStrings =
    NotionSidebarStrings(
        navLabel = "Sidebar navigation",
        favorites = "Favorites",
        pages = "Pages",
        filterNoMatch = "No matches.",
        filterClear = "Clear filter",
    )

private fun previewInput(withFavorites: Boolean = true): NotionSidebarInput =
    NotionSidebarInput(
        sections =
            listOf(
                NotionSidebarSection(
                    title = "Charging",
                    items =
                        listOf(
                            NotionNavItem("/charging", "Charging", NavGlyphs.Bolt),
                            NotionNavItem("/charging/curves", "Charging Curves", NavGlyphs.Chart),
                        ),
                ),
                NotionSidebarSection(
                    title = "Fleet",
                    items =
                        listOf(
                            NotionNavItem("/vehicles", "Vehicles", NavGlyphs.Car),
                            NotionNavItem("/data-repair", "Data Repair", NavGlyphs.Server),
                        ),
                ),
            ),
        pinnedItems = if (withFavorites) listOf(NotionNavItem("/", "Dashboard", NavGlyphs.Dashboard)) else emptyList(),
        activeSectionTitle = "Charging",
        vehicleCount = 3,
        staleCount = 12,
    )

@Composable
private fun NotionSidebarPreviewAt(
    currentPath: String,
    filter: String = "",
    collapsed: Set<String> = emptySet(),
    input: NotionSidebarInput = previewInput(),
) {
    TeslaSyncTheme(dynamicColor = false) {
        Surface(color = MaterialTheme.colorScheme.surface) {
            NotionSidebarContent(
                display = NotionSidebarProjection.project(input, currentPath, filter, collapsed, previewStrings()),
            )
        }
    }
}

@Preview(name = "NotionSidebar · Charging active", showBackground = true)
@Composable
private fun NotionSidebarChargingPreview() {
    NotionSidebarPreviewAt(currentPath = "/charging", collapsed = setOf("Fleet"))
}

@Preview(name = "NotionSidebar · all collapsed", showBackground = true)
@Composable
private fun NotionSidebarCollapsedPreview() {
    NotionSidebarPreviewAt(currentPath = "/charging", collapsed = setOf("Charging", "Fleet"))
}

@Preview(name = "NotionSidebar · trailing badges", showBackground = true)
@Composable
private fun NotionSidebarBadgesPreview() {
    NotionSidebarPreviewAt(currentPath = "/vehicles")
}

@Preview(name = "NotionSidebar · no matches", showBackground = true)
@Composable
private fun NotionSidebarNoMatchesPreview() {
    NotionSidebarPreviewAt(currentPath = "/charging", filter = "zzzz")
}

@Preview(name = "NotionSidebar · no favorites", showBackground = true)
@Composable
private fun NotionSidebarNoFavoritesPreview() {
    NotionSidebarPreviewAt(currentPath = "/data-repair", input = previewInput(withFavorites = false))
}
