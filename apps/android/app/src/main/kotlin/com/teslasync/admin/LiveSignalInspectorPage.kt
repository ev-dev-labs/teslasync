// The native Jetpack Compose + Material 3 LiveSignalInspectorPage admin surface — a parity port of
// web/src/features/admin/pages/LiveSignalInspectorPage.tsx (and its LiveSignalsTable sub-component), the
// realtime per-vehicle signal viewer. It reproduces the page's three GlassPanels (the vehicle-picker controls,
// the no-vehicle empty panel, and the live-snapshot panel with its filterable/sortable table), every data
// state (loading / empty / error / content), and every visible string (resolved from the generated res/values
// catalog, ADR-014).
//
// Composition: [LiveSignalInspectorPage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the selection + the two feeds, and drives the
// foreground 1 s poll while a vehicle is selected — web `refetchInterval` with `refetchIntervalInBackground:
// false`); [LiveSignalInspectorPageContent] is the stateless render layer driven entirely by the selection +
// two [UiState]s + [LiveSignalInspectorActions]. All row derivation lives in the framework-free model
// (LiveSignalInspectorPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.admin.livesignals

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.FreshnessIndicator
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse

/** The page's interaction callbacks, wired to the [LiveSignalInspectorPageViewModel] (web event handlers). */
data class LiveSignalInspectorActions(
    val onSelectVehicle: (Long?) -> Unit,
    val onRetry: () -> Unit,
)

private const val POLL_INTERVAL_MS = 1_000L

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [LiveSignalInspectorPageViewModel] over the supplied [source] (the host wires
 * the shared Vehicles + Telemetry holders via [liveSignalInspectorSource]). [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun LiveSignalInspectorPage(
    source: LiveSignalInspectorSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: LiveSignalInspectorPageViewModel =
        viewModel(
            key = LiveSignalInspectorRegistration.SLUG,
            factory = viewModelFactory { initializer { LiveSignalInspectorPageViewModel(source, logger) } },
        )
    LiveSignalInspectorPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic, binds the [viewModel] selection + the two
 * feeds to the stateless content, and drives the foreground poll (web `refetchInterval: 1_000`). The poll loops
 * only while a vehicle is selected and the screen is in composition, so leaving the page stops it — the native
 * analogue of `refetchIntervalInBackground: false`.
 */
@Composable
fun LiveSignalInspectorPage(
    viewModel: LiveSignalInspectorPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val selection by viewModel.selection.collectAsStateWithLifecycle()
    val vehicles by viewModel.vehicles.collectAsStateWithLifecycle()
    val signals by viewModel.signals.collectAsStateWithLifecycle()

    LaunchedEffect(selection) {
        if (selection == null) return@LaunchedEffect
        while (true) {
            kotlinx.coroutines.delay(POLL_INTERVAL_MS)
            viewModel.refreshLive()
        }
    }

    val actions =
        remember(viewModel) {
            LiveSignalInspectorActions(
                onSelectVehicle = viewModel::selectVehicle,
                onRetry = viewModel::retry,
            )
        }

    LiveSignalInspectorPageContent(
        selection = selection,
        vehicles = vehicles,
        signals = signals,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the controls panel, and either the no-vehicle panel or the snapshot. */
@Composable
fun LiveSignalInspectorPageContent(
    selection: Long?,
    vehicles: UiState<List<Vehicle>>,
    signals: UiState<VehicleLiveSignalsResponse>,
    actions: LiveSignalInspectorActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        LiveSignalInspectorHeader(selected = selection != null, fetchedAt = signals.fetchedAt)

        FadeIn {
            LiveSignalControlsPanel(
                selection = selection,
                vehicles = vehicles.data ?: emptyList(),
                onSelectVehicle = actions.onSelectVehicle,
            )
        }

        if (selection == null) {
            NoVehiclePanel()
        } else {
            FadeIn(delayMs = FADE_STEP_MS) {
                LiveSnapshotPanel(signals = signals, onRetry = actions.onRetry)
            }
        }
    }
}

@Composable
private fun LiveSignalInspectorHeader(
    selected: Boolean,
    fetchedAt: Long?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(stringResource(R.string.translation_admin_liveSignals_pageTitle))
            BodyText(
                stringResource(R.string.translation_admin_liveSignals_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (selected) {
            // Live freshness of the snapshot feed — surfaces a stale/offline pulse per ADR-013 (web `LiveIndicator`).
            FreshnessIndicator(timestampMillis = fetchedAt, showLabel = false)
        }
    }
}

// ── GlassPanel1 — vehicle picker controls (web GlassPanel @ L67) ────────────────────────────────────────────

@Composable
private fun LiveSignalControlsPanel(
    selection: Long?,
    vehicles: List<Vehicle>,
    onSelectVehicle: (Long?) -> Unit,
) {
    val emptyLabel = stringResource(R.string.translation_admin_liveSignals_controls_selectVehicle)
    val vehicleAria = stringResource(R.string.translation_admin_liveSignals_controls_vehicleAria)
    val options =
        remember(vehicles, emptyLabel) {
            buildList {
                add(SelectOption(value = "", label = emptyLabel))
                vehicles.forEach { v -> add(SelectOption(value = v.id.toString(), label = vehicleLabel(v))) }
            }
        }

    GlassPanel(padding = PanelPadding.Md) {
        Column(modifier = Modifier.fillMaxWidth().semantics { contentDescription = vehicleAria }) {
            Select(
                options = options,
                selectedValue = selection?.toString() ?: "",
                onSelect = { value -> onSelectVehicle(value.takeIf { it.isNotEmpty() }?.toLongOrNull()) },
                emptyLabel = emptyLabel,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// ── GlassPanel2 — no vehicle selected (web GlassPanel @ L88) ─────────────────────────────────────────────────

@Composable
private fun NoVehiclePanel() {
    val title = stringResource(R.string.translation_admin_liveSignals_noVehicle_title)
    GlassPanel(
        padding = PanelPadding.Md,
        modifier = Modifier.semantics { contentDescription = title },
    ) {
        EmptyState(
            message = stringResource(R.string.translation_admin_liveSignals_noVehicle_message),
            icon = LiveSignalGlyphs.Radio,
            title = title,
        )
    }
}

// ── GlassPanel3 — live snapshot (web GlassPanel @ L104) ──────────────────────────────────────────────────────

@Composable
private fun LiveSnapshotPanel(
    signals: UiState<VehicleLiveSignalsResponse>,
    onRetry: () -> Unit,
) {
    val title = stringResource(R.string.translation_admin_liveSignals_panels_snapshot)
    GlassPanel(
        padding = PanelPadding.Md,
        modifier = Modifier.semantics { contentDescription = title },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    LiveSignalGlyphs.Activity,
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                PanelTitle(title)
            }

            when {
                signals.isLoading -> SnapshotLoadingState()
                signals.isError -> SnapshotErrorState(onRetry = onRetry)
                else -> {
                    val rows = liveSignalRows(signals.data)
                    if (rows.isEmpty()) SnapshotEmptyState() else LiveSignalsTable(rows = rows)
                }
            }
        }
    }
}

@Composable
private fun SnapshotLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md, label = stringResource(R.string.translation_admin_liveSignals_table_loading))
    }
}

@Composable
private fun SnapshotErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ErrorText(stringResource(R.string.translation_error_loadFailed))
        Button(
            label = stringResource(R.string.translation_error_retry),
            onClick = onRetry,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

@Composable
private fun SnapshotEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_admin_liveSignals_empty_message),
        icon = LiveSignalGlyphs.Radio,
        title = stringResource(R.string.translation_admin_liveSignals_empty_title),
    )
}

// ── The filterable + sortable table (web LiveSignalsTable) ───────────────────────────────────────────────────

@Composable
private fun LiveSignalsTable(rows: List<LiveSignalRow>) {
    var filter by remember { mutableStateOf("") }
    var sortKey by remember { mutableStateOf(LiveSignalSortKey.Name) }
    var ascending by remember { mutableStateOf(true) }
    val filterAria = stringResource(R.string.translation_admin_liveSignals_filterAria)

    val visible = sortRows(filterRows(rows, filter), sortKey, ascending)

    fun toggleSort(key: LiveSignalSortKey) {
        if (sortKey == key) {
            ascending = !ascending
        } else {
            sortKey = key
            ascending = true
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Input(
            value = filter,
            onValueChange = { filter = it },
            leadingIcon = LiveSignalGlyphs.Search,
            hint = stringResource(R.string.translation_admin_liveSignals_filterPlaceholder), // parity:allow web string key literally named filterPlaceholder
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = filterAria },
        )

        LiveSignalsTableHeader(sortKey = sortKey, ascending = ascending, onSort = ::toggleSort)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        if (visible.isEmpty()) {
            Caption(stringResource(R.string.translation_admin_liveSignals_table_filtered))
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                visible.forEach { row -> LiveSignalRowItem(row) }
            }
        }
    }
}

@Composable
private fun LiveSignalsTableHeader(
    sortKey: LiveSignalSortKey,
    ascending: Boolean,
    onSort: (LiveSignalSortKey) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SortableHeader(
            label = stringResource(R.string.translation_admin_liveSignals_cols_name),
            active = sortKey == LiveSignalSortKey.Name,
            ascending = ascending,
            onClick = { onSort(LiveSignalSortKey.Name) },
            weight = NAME_WEIGHT,
        )
        Caption(
            text = stringResource(R.string.translation_admin_liveSignals_cols_value),
            modifier = Modifier.weight(VALUE_WEIGHT),
        )
        SortableHeader(
            label = stringResource(R.string.translation_admin_liveSignals_cols_timestamp),
            active = sortKey == LiveSignalSortKey.Timestamp,
            ascending = ascending,
            onClick = { onSort(LiveSignalSortKey.Timestamp) },
            weight = TS_WEIGHT,
        )
    }
}

@Composable
private fun RowScope.SortableHeader(
    label: String,
    active: Boolean,
    ascending: Boolean,
    onClick: () -> Unit,
    weight: Float,
) {
    val arrow = if (!active) "" else if (ascending) " \u25B2" else " \u25BC"
    Caption(
        text = "$label$arrow",
        modifier =
            Modifier
                .weight(weight)
                .clickable(onClick = onClick),
    )
}

@Composable
private fun LiveSignalRowItem(row: LiveSignalRow) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(text = row.name, modifier = Modifier.weight(NAME_WEIGHT))
        CodeText(text = renderValue(row.value), modifier = Modifier.weight(VALUE_WEIGHT))
        Caption(text = row.timestamp ?: EM_DASH, modifier = Modifier.weight(TS_WEIGHT))
    }
}

/** Build the picker label — web ``v.display_name || v.vin || `Vehicle ${v.id}` `` (id marker keeps it neutral). */
private fun vehicleLabel(vehicle: Vehicle): String =
    vehicle.displayName.ifBlank { vehicle.vin }.ifBlank { "#${vehicle.id}" }

private const val FADE_STEP_MS = 60
private const val NAME_WEIGHT = 3f
private const val VALUE_WEIGHT = 4f
private const val TS_WEIGHT = 3f
