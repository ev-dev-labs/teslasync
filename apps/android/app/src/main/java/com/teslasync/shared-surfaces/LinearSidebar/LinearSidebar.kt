// The native Jetpack Compose + Material 3 LinearSidebar shared surface — a parity port of
// web/src/components/layout/sidebar/LinearSidebar.tsx. The web component is a Linear/Notion-inspired quiet
// single-column nav: a permanent un-collapsable "Favorites" group (whenever ≥1 item is pinned), tiny uppercase
// click-to-collapse section headers, an active row marked only by a 2px left accent bar + medium weight, quiet
// page-marker glyphs, an inline tree filter that narrows the tree without flattening it, and a "No matches." +
// "Clear filter" affordance when the filter eliminates everything.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the nav tree only through
// the shared S8 state-holder seam ([LinearSidebarSource], driven by [LinearSidebarViewModel]); the composable
// is a thin render layer that resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the
// pure [LinearSidebarProjection] returns, using the shared component library (forms SearchInput, ui
// Button/Icon/IconButton/StatusPill/typography/TeslaGlyphs, feedback Skeleton/EmptyState/QueryError). It
// renders every state the prompt's matrix mandates without ever hiding a surface: shimmering skeleton chrome
// while the nav loads, the filtered tree, a friendly empty state for an empty nav, a "no results" row when the
// filter eliminates every section, a hard error surfaced as the shared `QueryError` with retry, and the
// stale/offline freshness chip (with auto-refresh) over cached rows. The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LinearSidebar) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.linearsidebar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered sidebar in any state. */
const val LINEAR_SIDEBAR_TEST_TAG: String = "linear-sidebar"

/** Test tag on the no-results row so tests can assert the empty-filter branch (web `linear-sidebar-empty-filter`). */
const val LINEAR_SIDEBAR_NO_MATCH_TEST_TAG: String = "linear-sidebar-empty-filter"

private const val COUNT_CHIP_MAX = 99
private val ACCENT_BAR_WIDTH = 2.dp
private val ACCENT_BAR_HEIGHT = 18.dp
private val ALERT_DOT_SIZE = 8.dp
private val ROW_SHAPE = RoundedCornerShape(8.dp)
private val CHIP_SHAPE = RoundedCornerShape(6.dp)
private const val LOADING_ROW_COUNT = 6
private val LOADING_ROW_HEIGHT = 18.dp
private const val ACTIVE_ROW_BG_ALPHA = 0.06f

/** Which pin affordance a row exposes: unpin (favorites), pin (un-pinned section row), or none. */
private enum class RowAction { Pin, Unpin, None }

/**
 * Stateful entry point — the parity port of the web `<LinearSidebar sections … pinnedItems … pathname … />`.
 * Binds the nav tree via [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first
 * composition, collects the [LinearSidebarUiModel], auto-expands the active section after navigation and
 * auto-refreshes a stale cache, then renders.
 *
 * @param viewModel the state holder bound to the shared S8 [LinearSidebarSource] nav seam.
 * @param onNavigate fired with a route when a nav row is followed (host wires it to the NavController).
 * @param onPin fired with a route to pin it to Favorites (web `onPin`).
 * @param onUnpin fired with a route to remove it from Favorites (web `onUnpin`).
 * @param onItemSelect fired when any row is followed — a mobile host uses it to close the drawer (web `onItemSelect`).
 */
@Composable
fun LinearSidebar(
    viewModel: LinearSidebarViewModel,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    onPin: (String) -> Unit = {},
    onUnpin: (String) -> Unit = {},
    onItemSelect: () -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val model by viewModel.uiModel.collectAsStateWithLifecycle()

    // Web's useEffect: when the active section changes (navigation moved into a collapsed section), expand it.
    LaunchedEffect(model.display.activeSectionTitle) {
        model.display.activeSectionTitle?.let(viewModel::expandSection)
    }
    // Stale TTL -> auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(model.display.stale, model.display.freshnessStamp) {
        if (model.display.stale) viewModel.refresh()
    }

    LinearSidebarContent(
        model = model,
        modifier = modifier,
        onFilterChange = viewModel::onFilterChange,
        onClearFilter = viewModel::clearFilter,
        onToggleSection = viewModel::toggleSection,
        onNavigate = onNavigate,
        onPin = onPin,
        onUnpin = onUnpin,
        onItemSelect = onItemSelect,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless LinearSidebar — renders every branch the web source draws plus the nav feed's lifecycle: the
 * inline tree-filter box, the Favorites group, the collapsible sections with their quiet rows, the "no
 * results" branch, the skeleton chrome, the empty state, the shared `QueryError`, and the stale/offline
 * freshness chip. Hoisted out of the ViewModel so it is preview- and screenshot-testable for each state. The
 * host is expected to place it in a height-bounded sidebar column; the tree scrolls within the available space.
 */
@Composable
fun LinearSidebarContent(
    model: LinearSidebarUiModel,
    modifier: Modifier = Modifier,
    onFilterChange: (String) -> Unit = {},
    onClearFilter: () -> Unit = {},
    onToggleSection: (String) -> Unit = {},
    onNavigate: (String) -> Unit = {},
    onPin: (String) -> Unit = {},
    onUnpin: (String) -> Unit = {},
    onItemSelect: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    val display = model.display
    val sidebarLabel = stringResource(R.string.translation_nav_sidebar)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(LINEAR_SIDEBAR_TEST_TAG)
                .semantics { contentDescription = sidebarLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SearchInput(
            value = model.filterQuery,
            onValueChange = onFilterChange,
            hint = stringResource(R.string.translation_common_search),
            clearLabel = stringResource(R.string.translation_common_clear),
        )
        when (display.phase) {
            LinearSidebarPhase.Loading -> LinearSidebarLoading()
            LinearSidebarPhase.Empty ->
                EmptyState(
                    message = stringResource(R.string.translation_common_noData),
                    modifier = Modifier.fillMaxWidth(),
                )
            LinearSidebarPhase.Error ->
                QueryError(
                    kind = LinearSidebarProjection.queryErrorKind(display),
                    modifier = Modifier.fillMaxWidth(),
                    onRetry = onRetry,
                )
            LinearSidebarPhase.Content ->
                LinearSidebarTree(
                    display = display,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    onToggleSection = onToggleSection,
                    onNavigate = onNavigate,
                    onPin = onPin,
                    onUnpin = onUnpin,
                    onItemSelect = onItemSelect,
                    onClearFilter = onClearFilter,
                )
        }
        LinearSidebarFreshnessLine(display = display, onRetry = onRetry)
    }
}

/** Shimmering skeleton chrome shown while a first nav load is in flight (web `isLoading`). */
@Composable
private fun LinearSidebarLoading() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(Spacing.sm)
                .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROW_COUNT) { Skeleton(height = LOADING_ROW_HEIGHT) }
    }
}

/** The resolved, scrollable tree: the Favorites group, then each section header + its rows, then no-results. */
@Composable
private fun LinearSidebarTree(
    display: LinearSidebarDisplay,
    modifier: Modifier = Modifier,
    onToggleSection: (String) -> Unit,
    onNavigate: (String) -> Unit,
    onPin: (String) -> Unit,
    onUnpin: (String) -> Unit,
    onItemSelect: () -> Unit,
    onClearFilter: () -> Unit,
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (display.hasFavorites) {
            LinearSidebarSectionLabel(title = stringResource(R.string.translation_nav_favorites), icon = TeslaGlyphs.Pin)
            display.favorites.forEach { row ->
                LinearNavRowView(
                    row = row,
                    action = RowAction.Unpin,
                    onNavigate = onNavigate,
                    onPin = onPin,
                    onUnpin = onUnpin,
                    onItemSelect = onItemSelect,
                )
            }
            Spacer(Modifier.height(Spacing.sm))
        }

        display.sections.forEach { section ->
            LinearSidebarSectionHeader(section = section, onToggle = onToggleSection)
            if (section.expanded) {
                section.rows.forEach { row ->
                    LinearNavRowView(
                        row = row,
                        action = if (row.pinned) RowAction.None else RowAction.Pin,
                        onNavigate = onNavigate,
                        onPin = onPin,
                        onUnpin = onUnpin,
                        onItemSelect = onItemSelect,
                    )
                }
            }
        }

        if (display.noResults) {
            EmptyState(
                message = stringResource(R.string.translation_nav_filterNoMatch),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag(LINEAR_SIDEBAR_NO_MATCH_TEST_TAG)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                action =
                    EmptyStateAction(
                        label = stringResource(R.string.translation_nav_filterClear),
                        onClick = onClearFilter,
                    ),
            )
        }
    }
}

/** The Favorites group label (web's permanent pinned header) — a quiet pin glyph + uppercase-muted title. */
@Composable
private fun LinearSidebarSectionLabel(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Caption(title)
    }
}

/** One collapsible section header: a rotating chevron, the muted title, and the item count (web header). */
@Composable
private fun LinearSidebarSectionHeader(
    section: LinearSectionRow,
    onToggle: (String) -> Unit,
) {
    val toggleLabel =
        stringResource(
            if (section.expanded) R.string.translation_automations_presets_collapse else R.string.translation_automations_presets_expand,
        )
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(ROW_SHAPE)
                .clickable(role = Role.Button, onClickLabel = toggleLabel) { onToggle(section.title) }
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics {
                    heading()
                    stateDescription = toggleLabel
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = if (section.expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Caption(section.title, modifier = Modifier.weight(1f))
        if (section.itemCount > 0) Caption(section.itemCount.toString())
    }
}

/**
 * One nav row — the leading active accent bar, the quiet page-marker glyph, the label (medium weight when
 * active, web `font-medium`), the trailing badge, and the pin/unpin affordance. The whole row is a single
 * accessible target labelled by its text; the pin/unpin button is a separate labelled control.
 */
@Composable
private fun LinearNavRowView(
    row: LinearNavRow,
    action: RowAction,
    onNavigate: (String) -> Unit,
    onPin: (String) -> Unit,
    onUnpin: (String) -> Unit,
    onItemSelect: () -> Unit,
) {
    val activeBg = MaterialTheme.colorScheme.onSurface.copy(alpha = ACTIVE_ROW_BG_ALPHA)
    val currentPage = stringResource(R.string.translation_nav_currentPage)
    val contentColor = if (row.active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(ROW_SHAPE)
                .then(if (row.active) Modifier.background(activeBg) else Modifier)
                .clickable(role = Role.Tab) {
                    onNavigate(row.to)
                    onItemSelect()
                }.padding(end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs)
                .semantics {
                    if (row.active) {
                        selected = true
                        stateDescription = currentPage
                    }
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Box(
            modifier =
                Modifier
                    .width(ACCENT_BAR_WIDTH)
                    .height(ACCENT_BAR_HEIGHT)
                    .clip(CHIP_SHAPE)
                    .background(if (row.active) MaterialTheme.colorScheme.primary else Color.Transparent),
        )
        Icon(
            imageVector = row.icon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = if (row.active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = row.label,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (row.active) FontWeight.Medium else FontWeight.Normal,
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        row.trailing?.let { LinearTrailingBadge(it) }
        LinearRowAction(row = row, action = action, onPin = onPin, onUnpin = onUnpin)
    }
}

/** The pin/unpin trailing control for a row, or nothing when the row exposes no pin affordance. */
@Composable
private fun LinearRowAction(
    row: LinearNavRow,
    action: RowAction,
    onPin: (String) -> Unit,
    onUnpin: (String) -> Unit,
) {
    when (action) {
        RowAction.Unpin ->
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = stringResource(R.string.translation_nav_unpinPage, row.label),
                onClick = { onUnpin(row.to) },
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        RowAction.Pin ->
            IconButton(
                imageVector = TeslaGlyphs.Pin,
                contentDescription = stringResource(R.string.translation_nav_pinPage, row.label),
                onClick = { onPin(row.to) },
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        RowAction.None -> Unit
    }
}

/** The quiet trailing marker: a decorative alert dot, or a labelled count chip for vehicles / stale rows. */
@Composable
private fun LinearTrailingBadge(badge: TrailingBadge) {
    when (badge) {
        TrailingBadge.AlertDot ->
            Box(
                modifier =
                    Modifier
                        .size(ALERT_DOT_SIZE)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
            )
        is TrailingBadge.Count -> {
            val text = if (badge.value > COUNT_CHIP_MAX) "$COUNT_CHIP_MAX+" else badge.value.toString()
            val label =
                when (badge.semantic) {
                    CountSemantic.Vehicles -> stringResource(R.string.translation_nav_vehicleCount, badge.value.toString())
                    CountSemantic.Stale -> stringResource(R.string.translation_nav_staleCount, badge.value.toString())
                }
            Box(
                modifier =
                    Modifier
                        .clip(CHIP_SHAPE)
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(horizontal = Spacing.xs, vertical = 1.dp)
                        .semantics { contentDescription = label },
                contentAlignment = Alignment.Center,
            ) {
                Caption(text)
            }
        }
    }
}

/**
 * The always-honest freshness line beneath the tree. A failed-refresh cache shows a danger "Offline" chip +
 * retry; a TTL-stale cache shows a warning "Stale" chip while it auto-refreshes. A hard error is surfaced in
 * the body itself (as `QueryError`), so nothing renders here when the data is fresh or hard-failed.
 */
@Composable
private fun LinearSidebarFreshnessLine(
    display: LinearSidebarDisplay,
    onRetry: () -> Unit,
) {
    when {
        display.offline ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                StatusPill(text = stringResource(R.string.translation_common_offline), tone = StatusTone.Danger)
                Button(
                    label = stringResource(R.string.translation_error_retry),
                    onClick = onRetry,
                    variant = ButtonVariant.Outline,
                    size = ButtonSize.Sm,
                )
            }
        display.stale ->
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs)) {
                StatusPill(text = stringResource(R.string.translation_mqtt_stale), tone = StatusTone.Warning)
            }
        else -> Unit
    }
}

// ── Previews — one per rendered state (content / searching / no-results / loading / empty / error / offline). ──

private fun previewNav(activePath: String = "/energy"): LinearSidebarNav =
    LinearSidebarNav(
        sections =
            listOf(
                LinearNavSection(
                    "Overview",
                    listOf(
                        LinearNavItem("/", "Dashboard", TeslaGlyphs.Octagon),
                        LinearNavItem("/vehicles", "Vehicles", TeslaGlyphs.Pin),
                    ),
                ),
                LinearNavSection(
                    "Energy",
                    listOf(
                        LinearNavItem("/energy", "Energy", TeslaGlyphs.Octagon),
                        LinearNavItem("/energy/battery", "Battery Health", TeslaGlyphs.Octagon),
                    ),
                ),
                LinearNavSection(
                    "Alerts",
                    listOf(LinearNavItem("/notifications/alerts", "Alerts", TeslaGlyphs.Warning)),
                ),
            ),
        pinnedItems = listOf(LinearNavItem("/vehicles", "Vehicles", TeslaGlyphs.Pin)),
        activePath = activePath,
        alertCount = 3,
        vehicleCount = 2,
    )

private fun previewModel(
    state: UiState<LinearSidebarNav>,
    filter: String = "",
): LinearSidebarUiModel {
    val collapsed = state.data?.let { LinearSidebarProjection.defaultCollapsed(it) } ?: emptySet()
    return LinearSidebarProjection.project(state, LinearSidebarInteraction(collapsed = collapsed, filter = filter))
}

@Composable
private fun PreviewFrame(model: LinearSidebarUiModel) {
    TeslaSyncTheme {
        LinearSidebarContent(model = model, modifier = Modifier.height(560.dp))
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun LinearSidebarContentPreview() = PreviewFrame(previewModel(UiState(UiPhase.Content, data = previewNav(), fetchedAt = 1L)))

@Preview(name = "Searching", showBackground = true)
@Composable
private fun LinearSidebarSearchingPreview() =
    PreviewFrame(previewModel(UiState(UiPhase.Content, data = previewNav(), fetchedAt = 1L), filter = "energy"))

@Preview(name = "No results", showBackground = true)
@Composable
private fun LinearSidebarNoResultsPreview() =
    PreviewFrame(previewModel(UiState(UiPhase.Content, data = previewNav(), fetchedAt = 1L), filter = "zzzz"))

@Preview(name = "Loading", showBackground = true)
@Composable
private fun LinearSidebarLoadingPreview() = PreviewFrame(previewModel(UiState.loading()))

@Preview(name = "Empty", showBackground = true)
@Composable
private fun LinearSidebarEmptyPreview() =
    PreviewFrame(previewModel(UiState(UiPhase.Empty, data = LinearSidebarNav(emptyList()), fetchedAt = 1L)))

@Preview(name = "Error", showBackground = true)
@Composable
private fun LinearSidebarErrorPreview() = PreviewFrame(previewModel(UiState(UiPhase.Error, errorKind = ErrorKind.Network)))

@Preview(name = "Offline", showBackground = true)
@Composable
private fun LinearSidebarOfflinePreview() =
    PreviewFrame(
        previewModel(
            UiState(UiPhase.Content, data = previewNav(), fetchedAt = 1L, stale = true, errorKind = ErrorKind.Network),
        ),
    )
