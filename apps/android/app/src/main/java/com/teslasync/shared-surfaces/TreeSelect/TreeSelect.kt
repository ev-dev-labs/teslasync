// The native Jetpack Compose + Material 3 TreeSelect shared surface — a parity port of
// web/src/components/forms/TreeSelect.tsx. The web component is the shared two-level (groups -> leaves)
// tri-state multi-select primitive: a search box that narrows the tree without flattening it, a top-level
// select-all/clear control with a live "{selected} of {total}" count, collapsible group headers carrying a
// tri-state (none/partial/all) checkbox and a per-group "{selected}/{total}" count, and per-leaf checkboxes
// with a visible-but-uncheckable disabled state.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the group catalog only
// through the shared S8 state-holder seam ([TreeSelectSource], driven by [TreeSelectViewModel]); the
// composable is a thin render layer that resolves the i18n labels (P1/S10) and design tokens (P1/S9) and
// draws what the pure [TreeSelectProjection] returns, using the shared component library (forms SearchInput,
// ui TriStateCheckbox/Checkbox/Icon/Button/StatusPill/typography, feedback Skeleton/EmptyState/QueryError). It
// renders every state the prompt's matrix mandates without ever hiding a surface: shimmering skeleton chrome
// while the catalog loads, the filtered tree, a friendly empty row for an empty catalog, a "no results" row
// when the search eliminates every leaf, a hard error surfaced as the shared `QueryError` with retry, and the
// stale/offline freshness chip (with auto-refresh) over cached rows. The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) fires on first composition.
//
// The atomic `components/forms/TreeSelect` is the bare static-catalog primitive (the component-library
// bundle, out of scope here); THIS surface is the state-aware, lifecycle-driven picker built around the same
// `TreeGroup`/`TreeLeaf`. `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TreeSelect) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.treeselect

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.forms.TreeGroup
import io.teslasync.android.components.forms.TreeLeaf
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered tree in any state. */
const val TREE_SELECT_TEST_TAG: String = "tree-select"

private val TREE_MAX_HEIGHT = 360.dp
private const val LOADING_ROW_COUNT = 5
private val LOADING_ROW_HEIGHT = 18.dp

/**
 * Stateful entry point — the parity port of the web `<TreeSelect groups … selectedIds … onChange … />`. Binds
 * the catalog via [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition,
 * collects the [TreeSelectUiModel], auto-refreshes a stale cache, surfaces the current selection through
 * [onSelectionChange], and renders.
 *
 * @param viewModel the state holder bound to the shared S8 [TreeSelectSource] catalog seam.
 * @param label the surface's accessible name (web `ariaLabel`) — resolved from a P1/S10 key by the host.
 * @param enabled when false, the search box and every toggle are disabled.
 * @param onSelectionChange fired with the next selected-id set whenever the selection changes (web `onChange`).
 */
@Composable
fun TreeSelect(
    viewModel: TreeSelectViewModel,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onSelectionChange: (Set<String>) -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val model by viewModel.uiModel.collectAsStateWithLifecycle()
    val selection by viewModel.selected.collectAsStateWithLifecycle()

    LaunchedEffect(selection) { onSelectionChange(selection) }
    // Stale TTL -> auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(model.display.stale, model.display.freshnessStamp) {
        if (model.display.stale) viewModel.refresh()
    }

    TreeSelectContent(
        model = model,
        label = label,
        modifier = modifier,
        enabled = enabled,
        onSearchChange = viewModel::onSearchChange,
        onToggleLeaf = viewModel::toggleLeaf,
        onToggleGroup = viewModel::toggleGroup,
        onToggleAll = viewModel::toggleAllVisible,
        onClearAll = viewModel::clearAll,
        onToggleExpanded = viewModel::toggleExpanded,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless TreeSelect — renders every branch the web source draws plus the catalog feed's lifecycle: the
 * search box, the top-level select-all/clear header with its live count, and the bordered, scrollable tree
 * body (skeleton chrome while loading, the filtered groups + leaves, a friendly empty row, a "no results"
 * row, or the shared `QueryError` on a hard failure), with a stale/offline freshness chip beneath. Hoisted
 * out of the ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun TreeSelectContent(
    model: TreeSelectUiModel,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onSearchChange: (String) -> Unit = {},
    onToggleLeaf: (String) -> Unit = {},
    onToggleGroup: (String) -> Unit = {},
    onToggleAll: () -> Unit = {},
    onClearAll: () -> Unit = {},
    onToggleExpanded: (String) -> Unit = {},
    onRetry: () -> Unit = {},
) {
    val display = model.display
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(TREE_SELECT_TEST_TAG)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SearchInput(
            value = model.searchQuery,
            onValueChange = onSearchChange,
            hint = stringResource(R.string.translation_common_search),
            clearLabel = stringResource(R.string.translation_common_clear),
        )
        TreeSelectHeader(
            display = display,
            enabled = enabled,
            onToggleAll = onToggleAll,
            onClearAll = onClearAll,
        )
        TreeSelectBody(
            display = display,
            enabled = enabled,
            onToggleLeaf = onToggleLeaf,
            onToggleGroup = onToggleGroup,
            onToggleExpanded = onToggleExpanded,
            onRetry = onRetry,
        )
        TreeSelectStatusLine(display = display, onRetry = onRetry)
    }
}

/** Top header: the tri-state select-all/clear control on the left, the live selected count + clear on the right. */
@Composable
private fun TreeSelectHeader(
    display: TreeSelectDisplay,
    enabled: Boolean,
    onToggleAll: () -> Unit,
    onClearAll: () -> Unit,
) {
    val toggleEnabled = enabled && display.selectAllEnabled
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        TriStateCheckbox(
            state = display.selectAllState.toToggleableState(),
            onClick = if (toggleEnabled) onToggleAll else null,
            label = selectAllLabel(display),
            enabled = toggleEnabled,
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(selectedCountText(display))
            if (display.selectedCount > 0 && enabled) {
                Button(
                    label = stringResource(R.string.translation_table_bulkActions_clear),
                    onClick = onClearAll,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }
    }
}

/** The bordered, scrollable tree body — the one mutually-exclusive surface for the current catalog phase. */
@Composable
private fun TreeSelectBody(
    display: TreeSelectDisplay,
    enabled: Boolean,
    onToggleLeaf: (String) -> Unit,
    onToggleGroup: (String) -> Unit,
    onToggleExpanded: (String) -> Unit,
    onRetry: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.medium)
                .clip(MaterialTheme.shapes.medium)
                .heightIn(max = TREE_MAX_HEIGHT)
                .verticalScroll(rememberScrollState()),
    ) {
        when (display.phase) {
            TreeSelectPhase.Loading -> TreeSelectLoading()
            TreeSelectPhase.Empty ->
                EmptyState(
                    message = stringResource(R.string.translation_common_noData),
                    modifier = Modifier.fillMaxWidth(),
                )
            TreeSelectPhase.Error ->
                QueryError(
                    kind = TreeSelectProjection.queryErrorKind(display),
                    modifier = Modifier.fillMaxWidth(),
                    onRetry = onRetry,
                )
            TreeSelectPhase.Content ->
                if (display.noResults) {
                    EmptyState(
                        message = stringResource(R.string.translation_combobox_noResults),
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    TreeSelectTree(
                        display = display,
                        enabled = enabled,
                        onToggleLeaf = onToggleLeaf,
                        onToggleGroup = onToggleGroup,
                        onToggleExpanded = onToggleExpanded,
                    )
                }
        }
    }
}

/** Shimmering skeleton chrome shown while a first catalog load is in flight (web `isLoading`). */
@Composable
private fun TreeSelectLoading() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(Spacing.md)
                .semantics {
                    contentDescription = ""
                    liveRegion = LiveRegionMode.Polite
                },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROW_COUNT) { Skeleton(height = LOADING_ROW_HEIGHT) }
    }
}

/** The resolved tree: each filtered group header followed by its leaves when expanded. */
@Composable
private fun TreeSelectTree(
    display: TreeSelectDisplay,
    enabled: Boolean,
    onToggleLeaf: (String) -> Unit,
    onToggleGroup: (String) -> Unit,
    onToggleExpanded: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs)) {
        display.groups.forEach { group ->
            TreeSelectGroupHeader(
                group = group,
                enabled = enabled,
                onToggleGroup = onToggleGroup,
                onToggleExpanded = onToggleExpanded,
            )
            if (group.expanded) {
                group.leaves.forEach { leaf ->
                    TreeSelectLeafRow(leaf = leaf, enabled = enabled, onToggleLeaf = onToggleLeaf)
                }
            }
        }
    }
}

/** One group header row: a chevron (expand/collapse), a tri-state group checkbox, the label, and the count. */
@Composable
private fun TreeSelectGroupHeader(
    group: TreeSelectGroupRow,
    enabled: Boolean,
    onToggleGroup: (String) -> Unit,
    onToggleExpanded: (String) -> Unit,
) {
    val expandLabel =
        stringResource(
            if (group.expanded) {
                R.string.translation_automations_presets_collapse
            } else {
                R.string.translation_automations_presets_expand
            },
        )
    val groupToggle: (() -> Unit)? = if (enabled && group.toggleEnabled) ({ onToggleGroup(group.id) }) else null
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(enabled = enabled, onClickLabel = expandLabel) { onToggleExpanded(group.id) }
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = if (group.expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TriStateCheckbox(
            state = group.selectionState.toToggleableState(),
            onClick = groupToggle,
            modifier = Modifier.semantics { contentDescription = group.label },
            enabled = enabled && group.toggleEnabled,
        )
        BodyText(group.label, modifier = Modifier.weight(1f), maxLines = 1)
        Caption("${group.selectedCount}/${group.totalCount}")
    }
}

/** One leaf row: a checkbox + label; disabled leaves are visible-but-uncheckable with their reason shown. */
@Composable
private fun TreeSelectLeafRow(
    leaf: TreeSelectLeafRow,
    enabled: Boolean,
    onToggleLeaf: (String) -> Unit,
) {
    val rowEnabled = enabled && !leaf.disabled
    val description =
        if (leaf.disabled && leaf.disabledReason != null) "${leaf.label}, ${leaf.disabledReason}" else leaf.label
    val rowModifier =
        if (rowEnabled) {
            Modifier.toggleable(
                value = leaf.selected,
                role = Role.Checkbox,
            ) { onToggleLeaf(leaf.id) }
        } else {
            Modifier
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .then(rowModifier)
                .padding(start = Spacing.xl, end = Spacing.sm, top = Spacing.xs, bottom = Spacing.xs)
                .semantics {
                    contentDescription = description
                    if (leaf.disabled) disabled()
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Checkbox(checked = leaf.selected, onCheckedChange = null, enabled = rowEnabled)
        BodyText(
            leaf.label,
            modifier = Modifier.weight(1f),
            color = if (rowEnabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        if (leaf.disabled && leaf.disabledReason != null) {
            Caption(leaf.disabledReason)
        }
    }
}

/**
 * The always-honest freshness line beneath the body. A failed-refresh cache shows a danger "Offline" chip +
 * retry; a TTL-stale cache shows a warning "Stale" chip while it auto-refreshes. A hard error is surfaced in
 * the body itself (as `QueryError`), so nothing renders here when the data is fresh or hard-failed.
 */
@Composable
private fun TreeSelectStatusLine(
    display: TreeSelectDisplay,
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

/** The visible-and-enabled select-all label for the current filter/selection (web `selectAllLabel`). */
@Composable
private fun selectAllLabel(display: TreeSelectDisplay): String =
    when {
        display.selectAllState == GroupSelectionState.All -> stringResource(R.string.translation_filters_clearAll)
        display.isSearching -> stringResource(R.string.translation_notifications_inbox_selectAll)
        else -> stringResource(R.string.translation_bulk_selectAll)
    }

/** "{n} selected" (web), suffixed with " of {total}" while searching so the hidden picks stay legible. */
@Composable
private fun selectedCountText(display: TreeSelectDisplay): String {
    val selected = stringResource(R.string.translation_table_bulkActions_selected, display.selectedCount.toString())
    return if (display.isSearching && display.totalLeafCount > 0) {
        "$selected ${stringResource(R.string.translation_bulk_ofTotal, display.totalLeafCount.toString())}"
    } else {
        selected
    }
}

private fun GroupSelectionState.toToggleableState(): ToggleableState =
    when (this) {
        GroupSelectionState.All -> ToggleableState.On
        GroupSelectionState.Partial -> ToggleableState.Indeterminate
        GroupSelectionState.None -> ToggleableState.Off
    }

// ── Previews — one per rendered state (content / collapsed / searching / loading / empty / no-results /
// error / stale / offline / disabled). ──────────────────────────────────────────────────────────────────

private val PREVIEW_GROUPS =
    listOf(
        TreeGroup(
            id = "powertrain",
            label = "Powertrain",
            leaves =
                listOf(
                    TreeLeaf("speed", "Vehicle speed"),
                    TreeLeaf("rpm", "Motor RPM"),
                    TreeLeaf("torque", "Drive torque"),
                ),
        ),
        TreeGroup(
            id = "battery",
            label = "Battery",
            leaves =
                listOf(
                    TreeLeaf("soc", "State of charge"),
                    TreeLeaf("volt", "Pack voltage"),
                    TreeLeaf("temp", "Pack temperature"),
                ),
        ),
        TreeGroup(
            id = "climate",
            label = "Climate",
            leaves = listOf(TreeLeaf("cabin", "Cabin temperature"), TreeLeaf("hvac", "HVAC power")),
        ),
    )

private const val PREVIEW_STAMP = 1_700_000_000_000L
private const val PREVIEW_SERVER_ERROR = 503

private fun previewModel(
    state: UiState<List<TreeGroup>>,
    selected: Set<String> = emptySet(),
    search: String = "",
    expanded: Set<String> = emptySet(),
    disabledReasons: Map<String, String> = emptyMap(),
): TreeSelectUiModel =
    TreeSelectProjection.project(
        state = state,
        interaction =
            TreeSelectInteraction(
                selectedIds = selected,
                searchQuery = search,
                expandedIds = expanded,
                disabledIds = disabledReasons.keys,
                disabledReasons = disabledReasons,
            ),
    )

@Preview(name = "TreeSelect · content", showBackground = true)
@Composable
private fun TreeSelectContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model =
                previewModel(
                    UiState(UiPhase.Content, PREVIEW_GROUPS, fetchedAt = PREVIEW_STAMP),
                    selected = setOf("speed", "soc"),
                    expanded = setOf("powertrain", "battery"),
                ),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · collapsed", showBackground = true)
@Composable
private fun TreeSelectCollapsedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model =
                previewModel(
                    UiState(UiPhase.Content, PREVIEW_GROUPS, fetchedAt = PREVIEW_STAMP),
                    selected = setOf("speed", "rpm", "torque"),
                ),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · searching", showBackground = true)
@Composable
private fun TreeSelectSearchingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model =
                previewModel(
                    UiState(UiPhase.Content, PREVIEW_GROUPS, fetchedAt = PREVIEW_STAMP),
                    selected = setOf("temp"),
                    search = "temp",
                ),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · loading", showBackground = true)
@Composable
private fun TreeSelectLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(model = previewModel(UiState.loading()), label = "Signals")
    }
}

@Preview(name = "TreeSelect · empty", showBackground = true)
@Composable
private fun TreeSelectEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model = previewModel(UiState(UiPhase.Empty, emptyList(), fetchedAt = PREVIEW_STAMP)),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · no results", showBackground = true)
@Composable
private fun TreeSelectNoResultsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model = previewModel(UiState(UiPhase.Content, PREVIEW_GROUPS, fetchedAt = PREVIEW_STAMP), search = "zzz"),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · error", showBackground = true)
@Composable
private fun TreeSelectErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model =
                previewModel(
                    UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = PREVIEW_SERVER_ERROR),
                ),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · stale", showBackground = true)
@Composable
private fun TreeSelectStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model =
                previewModel(
                    UiState(
                        phase = UiPhase.Content,
                        data = PREVIEW_GROUPS,
                        fetchedAt = PREVIEW_STAMP,
                        stale = true,
                        refreshing = true,
                    ),
                    expanded = setOf("powertrain"),
                ),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · offline (cached)", showBackground = true)
@Composable
private fun TreeSelectOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model =
                previewModel(
                    UiState(
                        phase = UiPhase.Content,
                        data = PREVIEW_GROUPS,
                        fetchedAt = PREVIEW_STAMP,
                        stale = true,
                        errorKind = ErrorKind.Network,
                    ),
                    expanded = setOf("battery"),
                ),
            label = "Signals",
        )
    }
}

@Preview(name = "TreeSelect · disabled leaves", showBackground = true)
@Composable
private fun TreeSelectDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TreeSelectContent(
            model =
                previewModel(
                    UiState(UiPhase.Content, PREVIEW_GROUPS, fetchedAt = PREVIEW_STAMP),
                    selected = setOf("speed"),
                    expanded = setOf("powertrain"),
                    disabledReasons = mapOf("torque" to "Not streamed by this vehicle"),
                ),
            label = "Signals",
        )
    }
}
