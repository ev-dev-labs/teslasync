// The native Jetpack Compose + Material 3 SignalDiffPage telemetry surface — a parity port of the web page
// web/src/features/telemetry/pages/SignalDiffPage.tsx, the two-snapshot signal-comparison workbench. It reproduces
// the page's five panels (the four StatCards — Changed signals / Visible after filter / Pinned / Window span — and
// the main GlassPanel that holds the diff table), every data state (loading skeletons / no-changes empty / success
// table, plus the error banner the web shows above the table), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [SignalDiffPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the five feeds + the interaction/selection snapshots);
// [SignalDiffPageContent] is the stateless render layer. The page owns the filter / category / selection / pinned
// state (web parity) and drives the table, the stat cards, and the bulk-actions toolbar from it, so the four
// StatCards and the bulk set stay coherent — exactly as the web page passes `filteredRows` / `selectedSignals` /
// `pinnedSignals` down to a presentational table. The A3 SignalCompareControls feature-view supplies the vehicle
// picker (top slot) + windows + presets + filter + category chips; the per-row cell formatting + delta + sort logic
// is reused from the sibling SignalDiffTable feature-view projection. Values are the raw SI the backend serves
// (Phase-42); the view performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `FlowRow` opt-in covers the wrapping chip rows.
@file:Suppress("InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.telemetry.signaldiff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.SourceLayerBadge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PinButton
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.signalcomparecontrols.SignalCompareControls
import io.teslasync.android.featureviews.signaldifftable.COL_DELTA
import io.teslasync.android.featureviews.signaldifftable.COL_NAME
import io.teslasync.android.featureviews.signaldifftable.DeltaSign
import io.teslasync.android.featureviews.signaldifftable.SignalDiffDelta
import io.teslasync.android.featureviews.signaldifftable.SignalDiffRowVm
import io.teslasync.android.featureviews.signaldifftable.SignalDiffTableProjection
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse

/** Em dash shown for a still-loading stat value — the web `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/** The number of skeleton rows the loading panel shows — web `Array.from({ length: 6 })`. */
private const val LOADING_SKELETON_ROWS: Int = 6

/** Skeleton row height in dp (web `<Skeleton height={36}>`). */
private const val SKELETON_HEIGHT_DP: Int = 36

/** Entrance-fade stagger between the stat row and the diff panel (web `FadeIn` delays). */
private const val FADE_STATS_MS: Int = 50
private const val FADE_PANEL_MS: Int = 100

/** The diff table column horizontal weights — the analogue of the web Tailwind width hints. */
private const val WEIGHT_PIN: Float = 0.5f
private const val WEIGHT_NAME: Float = 1.7f
private const val WEIGHT_VALUE: Float = 1.1f
private const val WEIGHT_DELTA: Float = 1.4f
private const val WEIGHT_SOURCE: Float = 0.8f

/** Low-alpha wash for the error banner background (web `bg-rose-500/[0.05]`). */
private const val ERROR_WASH_ALPHA: Float = 0.08f

/** The page's interaction callbacks, wired to the [SignalDiffPageViewModel] (web event handlers). */
data class SignalDiffActions(
    val onVehicle: (Long) -> Unit,
    val onWindowA: (String) -> Unit,
    val onWindowB: (String) -> Unit,
    val onFilter: (String) -> Unit,
    val onCategory: (String?) -> Unit,
    val onSelection: (Set<String>) -> Unit,
    val onClearSelection: () -> Unit,
    val onTogglePin: (String, Boolean) -> Unit,
    val onBulkPin: (List<String>, Set<String>) -> Unit,
    val onBulkUnpin: (List<String>, Set<String>) -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SignalDiffPageViewModel] over the supplied [source] (the host wires the shared
 * S8 Vehicles + Telemetry + Pinned holders via [signalDiffPageSourceOf]). [logger] defaults to the app's redacting
 * logger.
 */
@Composable
fun SignalDiffPage(
    source: SignalDiffPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SignalDiffPageViewModel =
        viewModel(
            key = SignalDiffPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SignalDiffPageViewModel(source, logger) } },
        )
    SignalDiffPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshots to the stateless content. */
@Composable
fun SignalDiffPage(
    viewModel: SignalDiffPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val selection by viewModel.selection.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val vehicleId by viewModel.vehicleId.collectAsStateWithLifecycle()
    val diffState by viewModel.diffState.collectAsStateWithLifecycle()
    val pinnedState by viewModel.pinnedState.collectAsStateWithLifecycle()
    val windowSpan by viewModel.windowSpan.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            SignalDiffActions(
                onVehicle = viewModel::setVehicle,
                onWindowA = viewModel::setWindowA,
                onWindowB = viewModel::setWindowB,
                onFilter = viewModel::setFilter,
                onCategory = viewModel::setCategory,
                onSelection = viewModel::setSelection,
                onClearSelection = viewModel::clearSelection,
                onTogglePin = viewModel::togglePin,
                onBulkPin = viewModel::bulkPin,
                onBulkUnpin = viewModel::bulkUnpin,
            )
        }

    SignalDiffPageContent(
        interaction = interaction,
        selection = selection,
        vehiclesState = vehiclesState,
        vehicleId = vehicleId,
        diffState = diffState,
        pinnedState = pinnedState,
        windowSpanSeconds = windowSpan,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle + share), the controls panel (vehicle picker top slot +
 * windows + presets + filter + category), the four StatCards, the bulk-actions toolbar (shown only while a
 * selection exists), and the diff panel (error banner / loading skeletons / no-changes empty / sortable selectable
 * table, with the pinned-signals legend). All filtered-row + pinned + window-span derivation comes from the
 * framework-free model, so this layer only resolves i18n + draws.
 */
@Composable
fun SignalDiffPageContent(
    interaction: SignalDiffInteraction,
    selection: Set<String>,
    vehiclesState: UiState<List<Vehicle>>,
    vehicleId: Long,
    diffState: UiState<SignalDiffServerResponse>,
    pinnedState: UiState<List<PinnedItem>>,
    windowSpanSeconds: Double?,
    actions: SignalDiffActions,
    modifier: Modifier = Modifier,
) {
    val allRows = remember(diffState.data) { SignalDiffTableProjection.projectRows(diffState.data) }
    val pinnedNames = remember(pinnedState.data) { pinnedSignalNames(pinnedState.data ?: emptyList()) }
    val filteredRows =
        remember(allRows, interaction.filter, interaction.category) {
            visibleRows(allRows, interaction.filter, interaction.category)
        }
    var sortState by remember { mutableStateOf(SortState(key = COL_NAME, direction = SortDirection.Asc)) }
    val sortedRows =
        remember(filteredRows, pinnedNames, sortState) {
            SignalDiffTableProjection.sortRows(filteredRows, pinnedNames, sortState)
        }
    val filterIsActive = filterActive(interaction.filter, interaction.category)

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SignalDiffHeader(vehicleId = vehicleId, interaction = interaction)

        SignalCompareControls(
            atA = interaction.atA,
            atB = interaction.atB,
            onChangeA = actions.onWindowA,
            onChangeB = actions.onWindowB,
            search = interaction.filter,
            onSearchChange = actions.onFilter,
            category = interaction.category,
            onCategoryChange = actions.onCategory,
            topSlot = { VehiclePickerSlot(vehiclesState = vehiclesState, vehicleId = vehicleId, onVehicle = actions.onVehicle) },
        )

        FadeIn(delayMs = FADE_STATS_MS) {
            SignalDiffStatRow(
                loading = diffState.isLoading,
                totalChanged = allRows.size,
                visible = filteredRows.size,
                pinnedCount = pinnedNames.size,
                windowSpanSeconds = windowSpanSeconds,
            )
        }

        if (selection.isNotEmpty()) {
            SignalDiffBulkToolbar(
                selection = selection,
                rows = sortedRows,
                pinnedNames = pinnedNames,
                actions = actions,
            )
        }

        FadeIn(delayMs = FADE_PANEL_MS) {
            SignalDiffPanel(
                diffState = diffState,
                interaction = interaction,
                rows = sortedRows,
                hasAnyRows = allRows.isNotEmpty(),
                filterActive = filterIsActive,
                pinnedNames = pinnedNames,
                selection = selection,
                sortState = sortState,
                onSortChange = { key -> sortState = sortState.toggledBy(key) },
                actions = actions,
            )
        }
    }
}

/** The page header — the title + muted subtitle and the share-link copy affordance (web `PageContainer` actions). */
@Composable
private fun SignalDiffHeader(
    vehicleId: Long,
    interaction: SignalDiffInteraction,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(stringResource(R.string.translation_signalDiff_title))
            BodyText(
                stringResource(R.string.translation_signalDiff_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val shareLabel = stringResource(R.string.translation_signalDiff_share)
        CopyButton(
            text = buildShareLink(vehicleId, interaction),
            copyLabel = shareLabel,
            copiedLabel = shareLabel,
            size = ButtonSize.Sm,
        )
    }
}

/** The vehicle picker rendered into the controls' top slot (web page-local `Select`). */
@Composable
private fun VehiclePickerSlot(
    vehiclesState: UiState<List<Vehicle>>,
    vehicleId: Long,
    onVehicle: (Long) -> Unit,
) {
    val vehicles = vehiclesState.data ?: emptyList()
    val options =
        remember(vehicles) {
            vehicles.map { vehicle ->
                SelectOption(value = vehicle.id.toString(), label = vehicle.displayName.ifBlank { vehicle.vin })
            }
        }
    Select(
        options = options,
        selectedValue = vehicleId.takeIf { it > 0L }?.toString(),
        onSelect = { value -> onVehicle(value.toLongOrNull() ?: 0L) },
        label = stringResource(R.string.translation_signalDiff_vehicle),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The four KPI tiles — Changed signals / Visible after filter / Pinned / Window span (web `StatCard` grid). */
@Composable
private fun SignalDiffStatRow(
    loading: Boolean,
    totalChanged: Int,
    visible: Int,
    pinnedCount: Int,
    windowSpanSeconds: Double?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringResource(R.string.translation_signalDiff_totalChanged),
                value = if (loading) EM_DASH else totalChanged.toString(),
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_signalDiff_visible),
                value = if (loading) EM_DASH else visible.toString(),
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringResource(R.string.translation_signalDiff_pinnedCount),
                value = pinnedCount.toString(),
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_signalDiff_windowSpan),
                value = formatWindowSpan(windowSpanSeconds),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** The bulk-actions toolbar shown while a selection exists — Pin / Unpin / Copy CSV / Add as alert rule. */
@Composable
private fun SignalDiffBulkToolbar(
    selection: Set<String>,
    rows: List<SignalDiffRowVm>,
    pinnedNames: Set<String>,
    actions: SignalDiffActions,
) {
    val clipboard = LocalClipboardManager.current
    GlassPanel(padding = PanelPadding.Sm) {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(
                stringResource(R.string.translation_signalDiff_pinnedLabel),
                modifier = Modifier.align(Alignment.CenterVertically),
            )
            Caption(selection.size.toString(), modifier = Modifier.align(Alignment.CenterVertically))
            Button(
                label = stringResource(R.string.translation_signalDiff_bulk_pin),
                onClick = { actions.onBulkPin(selection.toList(), pinnedNames) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Pin,
            )
            Button(
                label = stringResource(R.string.translation_signalDiff_bulk_unpin),
                onClick = { actions.onBulkUnpin(selection.toList(), pinnedNames) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = SignalDiffGlyphs.PinOff,
            )
            Button(
                label = stringResource(R.string.translation_signalDiff_bulk_csv),
                onClick = {
                    val selected = rows.filter { selection.contains(it.name) }
                    clipboard.setText(AnnotatedString(buildDiffCsv(selected)))
                },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Copy,
            )
            Button(
                label = stringResource(R.string.translation_signalDiff_bulk_addAlert),
                onClick = { clipboard.setText(AnnotatedString(alertSignalsPayload(selection))) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = SignalDiffGlyphs.Bell,
            )
            Button(
                label = stringResource(R.string.translation_signalDiff_clearCategory),
                onClick = actions.onClearSelection,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * The main diff panel (web `GlassPanel`): the error banner above the body, then one of the loading skeletons, the
 * no-changes empty state, or the sortable selectable diff table; the pinned-signals legend is appended below.
 */
@Composable
private fun SignalDiffPanel(
    diffState: UiState<SignalDiffServerResponse>,
    interaction: SignalDiffInteraction,
    rows: List<SignalDiffRowVm>,
    hasAnyRows: Boolean,
    filterActive: Boolean,
    pinnedNames: Set<String>,
    selection: Set<String>,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    actions: SignalDiffActions,
) {
    val windowsSet = interaction.atA.isNotBlank() && interaction.atB.isNotBlank()
    GlassPanel {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (diffState.hasError) {
                DiffErrorBanner()
            }
            when {
                diffState.isLoading && !diffState.hasData -> DiffLoadingSkeletons()
                !hasAnyRows && !filterActive && windowsSet -> DiffNoChanges()
                else ->
                    SignalDiffTableView(
                        rows = rows,
                        filterActive = filterActive,
                        pinnedNames = pinnedNames,
                        selection = selection,
                        sortState = sortState,
                        onSortChange = onSortChange,
                        actions = actions,
                    )
            }
            if (pinnedNames.isNotEmpty()) {
                PinnedBadges(pinnedNames = pinnedNames)
            }
        }
    }
}

/** The rose error banner above the table (web `signalDiff.error`); the cached table still renders below it. */
@Composable
private fun DiffErrorBanner() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = TeslaTokens.status.danger.copy(alpha = ERROR_WASH_ALPHA),
        contentColor = TeslaTokens.status.danger,
    ) {
        Text(
            stringResource(R.string.translation_signalDiff_error),
            modifier = Modifier.padding(Spacing.sm),
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

/** Six shimmering skeleton rows for the first diff load (web six `<Skeleton height={36}>`). */
@Composable
private fun DiffLoadingSkeletons() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(LOADING_SKELETON_ROWS) {
            Skeleton(height = SKELETON_HEIGHT_DP.dp)
        }
    }
}

/** The "no signals changed" empty state (web `GitCompare` glyph + `signalDiff.noChanges`). */
@Composable
private fun DiffNoChanges() {
    EmptyState(
        message = stringResource(R.string.translation_signalDiff_noChanges),
        icon = SignalDiffGlyphs.GitCompare,
    )
}

/** The sortable, multi-select diff table (web presentational `SignalDiffTable`). */
@Composable
private fun SignalDiffTableView(
    rows: List<SignalDiffRowVm>,
    filterActive: Boolean,
    pinnedNames: Set<String>,
    selection: Set<String>,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    actions: SignalDiffActions,
) {
    val pinLabel = stringResource(R.string.translation_pin_pin)
    val pinnedLabel = stringResource(R.string.translation_pin_pinned)
    val changedLabel = stringResource(R.string.translation_signalDiff_deltaChanged)
    val emptyText =
        if (filterActive) {
            stringResource(R.string.translation_signalDiff_tableNoMatches)
        } else {
            stringResource(R.string.translation_signalDiff_tableEmpty)
        }

    val columns =
        listOf<TableColumn<SignalDiffRowVm>>(
            TableColumn(key = "pin", header = "", weight = WEIGHT_PIN) { row ->
                val isPinned = pinnedNames.contains(row.name)
                PinButton(
                    pinned = isPinned,
                    onToggle = { actions.onTogglePin(row.name, !isPinned) },
                    pinLabel = pinLabel,
                    pinnedLabel = pinnedLabel,
                    size = IconSize.Sm,
                )
            },
            TableColumn(
                key = COL_NAME,
                header = stringResource(R.string.translation_signalDiff_signal),
                weight = WEIGHT_NAME,
                sortable = true,
            ) { row -> CodeText(row.name) },
            TableColumn(
                key = "value_a",
                header = stringResource(R.string.translation_signalDiff_valueA),
                weight = WEIGHT_VALUE,
                alignEnd = true,
            ) { row -> CodeText(row.valueA) },
            TableColumn(
                key = "value_b",
                header = stringResource(R.string.translation_signalDiff_valueB),
                weight = WEIGHT_VALUE,
                alignEnd = true,
            ) { row -> CodeText(row.valueB) },
            TableColumn(
                key = COL_DELTA,
                header = stringResource(R.string.translation_signalDiff_delta),
                weight = WEIGHT_DELTA,
                sortable = true,
                alignEnd = true,
            ) { row -> DeltaCell(delta = row.delta, changedLabel = changedLabel) },
            TableColumn(
                key = "source_a",
                header = stringResource(R.string.translation_signalDiff_sourceA),
                weight = WEIGHT_SOURCE,
            ) { row -> SourceLayerBadge(source = row.sourceA, ageMs = row.ageMsA) },
            TableColumn(
                key = "source_b",
                header = stringResource(R.string.translation_signalDiff_sourceB),
                weight = WEIGHT_SOURCE,
            ) { row -> SourceLayerBadge(source = row.sourceB, ageMs = row.ageMsB) },
        )

    DataTable(
        columns = columns,
        rows = rows,
        keyOf = { row -> row.name },
        sortState = sortState,
        onSortChange = onSortChange,
        selectable = true,
        selectedKeys = selection,
        onSelectedChange = { keys -> actions.onSelection(keys.map { it.toString() }.toSet()) },
        emptyText = emptyText,
    )
}

/** A single Δ cell — em dash (equal), the amber "changed" label, or the signed numeric delta tinted by sign. */
@Composable
private fun DeltaCell(
    delta: SignalDiffDelta,
    changedLabel: String,
) {
    when (delta) {
        SignalDiffDelta.None -> Caption(EM_DASH)
        SignalDiffDelta.Changed ->
            Text(
                changedLabel,
                style = MaterialTheme.typography.labelMedium,
                color = TeslaTokens.status.warning,
            )
        is SignalDiffDelta.Numeric ->
            Text(
                delta.text,
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                color = deltaSignColor(delta.sign),
            )
    }
}

/** The pinned-signals legend row beneath the table (web `Pinned:` + neutral name badges). */
@Composable
private fun PinnedBadges(pinnedNames: Set<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_signalDiff_pinnedLabel))
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            pinnedNames.sorted().forEach { name ->
                Badge(text = name, variant = BadgeVariant.Neutral)
            }
        }
    }
}

/** Maps a numeric delta sign to its tone color — positive good (green), negative bad (red), zero muted. */
@Composable
private fun deltaSignColor(sign: DeltaSign): Color =
    when (sign) {
        DeltaSign.Positive -> TeslaTokens.status.success
        DeltaSign.Negative -> TeslaTokens.status.danger
        DeltaSign.Zero -> MaterialTheme.colorScheme.onSurfaceVariant
    }
