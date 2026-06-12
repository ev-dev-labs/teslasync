// The native Jetpack Compose + Material 3 SignalDiffTable feature view — a parity port of
// web/src/features/telemetry/components/SignalDiffTable.tsx. The web component is the presentational tail of
// the Signal Diff page: a pinned-first, sortable `DataTable` of a server-side snapshot diff with a per-row
// pin toggle, a colored Δ (delta + percent) column, and L1/L2/LOG/STALE source-layer badges for both
// windows, plus a legend of `HelpTooltip`s explaining the technical columns and a friendly empty message.
// This native port keeps that composition and additionally surfaces the cache-then-network states the P3
// contract mandates (loading / empty / error / stale / offline) by binding the shared Telemetry feed (P1/S8)
// through a [SignalDiffTableViewModel]: a freshness chip + auto-refresh covers stale, a `QueryError` covers a
// hard failure with no cache, and the last-known diff stays visible while stale/offline. The web parent's
// signal filter is folded into the surface (mirroring the sibling LiveSignalsTable) so the surface binds the
// feed directly, stays self-contained, and can reach both empty messages; the filter reproduces the parent's
// `r.name.includes(needle)` behavior verbatim. Values are the raw SI the backend serves (Phase-42); the view
// performs no HTTP. Every visible string resolves through the i18n catalog and the filter carries a TalkBack
// label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalDiffTable) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signaldifftable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.SourceLayerBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.HelpTooltip
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PinButton
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.togglePresence
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalDiffRow
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import kotlinx.serialization.json.JsonPrimitive

// Column horizontal weights — the native analogue of the web Tailwind width hints (w-10 / w-28 / w-16).
private const val WEIGHT_PIN = 0.5f
private const val WEIGHT_NAME = 1.7f
private const val WEIGHT_VALUE = 1.1f
private const val WEIGHT_DELTA = 1.4f
private const val WEIGHT_SOURCE = 0.8f

/**
 * Stateful entry point. Binds the shared Telemetry feed via [source] into a [SignalDiffTableViewModel],
 * records the one-shot `view.opened` diagnostic, collects the projected [state], and renders. A host page
 * supplies the [source] (an adapter over the shared S7/S8 Telemetry layer), the selected [vehicleId] and the
 * two snapshot instants [atA] / [atB] (web parent's vehicle + window pickers), and optionally the
 * [signalsCsv] narrowing set. The ViewModel re-binds when any feed parameter changes.
 *
 * @param source the cache-then-network Telemetry seam (a `TelemetryRepository`/`TelemetryStore` adapter).
 * @param vehicleId the selected vehicle; a non-positive id renders the empty state (web disabled query).
 * @param atA the "Window A" snapshot instant; a blank window renders the empty state (web `enabled`).
 * @param atB the "Window B" snapshot instant; a blank window renders the empty state (web `enabled`).
 * @param signalsCsv optional CSV of signal names narrowing the diff (web parent's available-signals set).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey disambiguates multiple placements; the feed params are folded into the ViewModel key.
 */
@Composable
fun SignalDiffTable(
    source: SignalDiffTableSource,
    vehicleId: Long,
    atA: String,
    atB: String,
    modifier: Modifier = Modifier,
    signalsCsv: String = "",
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SIGNAL_DIFF_TABLE_SLUG,
) {
    val resolvedKey =
        remember(instanceKey, vehicleId, atA, atB, signalsCsv) { "$instanceKey:$vehicleId:$atA:$atB:$signalsCsv" }
    val query = remember(vehicleId, atA, atB, signalsCsv) { SignalDiffQuery(vehicleId, atA, atB, signalsCsv) }
    val viewModel: SignalDiffTableViewModel =
        viewModel(
            key = resolvedKey,
            factory = viewModelFactory { initializer { SignalDiffTableViewModel(source, logger, query) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberSignalDiffTableStrings()

    SignalDiffTableContent(
        state = state,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the filter field +
 * the column legend (web's always-present chrome); stale (non-error) data auto-refreshes. The body picks the
 * same branch the web component does, extended with the mandated error branch: a hard failure with no cached
 * rows shows `QueryError` with retry; a resolved feed with no diff rows shows the friendly empty state;
 * anything else shows the sortable, selectable, pinned-first table (its own footer message covers the loading
 * and filtered-empty sub-states). [onRefresh] backs the auto-refresh and the error retry.
 */
@Composable
fun SignalDiffTableContent(
    state: SignalDiffTableState,
    strings: SignalDiffTableStrings,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.isStale, state.isFetching, state.isError) {
        if (state.isStale && !state.isFetching && !state.isError) onRefresh()
    }

    var filter by remember { mutableStateOf("") }
    var sortState by remember { mutableStateOf(SortState(key = COL_NAME, direction = SortDirection.Asc)) }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var pinned by remember { mutableStateOf(emptySet<String>()) }

    val allRows = remember(state.response) { SignalDiffTableProjection.projectRows(state.response) }
    val visibleRows =
        remember(allRows, filter, pinned, sortState) {
            SignalDiffTableProjection.sortRows(
                SignalDiffTableProjection.filterRows(allRows, filter),
                pinned,
                sortState,
            )
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        FilterHeader(filter = filter, onFilterChange = { filter = it }, strings = strings, state = state)
        SignalDiffLegend(strings = strings)
        SignalDiffTableBody(
            state = state,
            strings = strings,
            visibleRows = visibleRows,
            hasAnyRows = allRows.isNotEmpty(),
            filterActive = filter.isNotBlank(),
            sortState = sortState,
            onSortChange = { key -> sortState = sortState.toggledBy(key) },
            selected = selected,
            onSelectedChange = { selected = it },
            pinned = pinned,
            onTogglePin = { name -> pinned = pinned.togglePresence(name) },
            onRetry = onRefresh,
        )
    }
}

@Composable
private fun FilterHeader(
    filter: String,
    onFilterChange: (String) -> Unit,
    strings: SignalDiffTableStrings,
    state: SignalDiffTableState,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Input(
            value = filter,
            onValueChange = onFilterChange,
            label = strings.filterHint,
            leadingIcon = FormsGlyphs.Search,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics { contentDescription = strings.filterAria },
        )
        if (state.updatedAtMillis != null || state.isFetching || state.isError) {
            DataFreshness(
                updatedAtMillis = state.updatedAtMillis?.takeIf { it > 0 },
                isFetching = state.isFetching,
                isStale = state.isStale,
                isError = state.isError,
                compact = true,
            )
        }
    }
}

/**
 * The legend explaining the two technical column groups — the web header tooltips. The shared `DataTable`
 * header is `String`-only, so the per-column help lives here above it, exactly as the web component does.
 */
@Composable
private fun SignalDiffLegend(strings: SignalDiffTableStrings) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        HelpTooltip(
            title = strings.legendDelta,
            helpText = strings.legendDeltaHelp,
            helpContentDescription = strings.legendDeltaAria,
        )
        HelpTooltip(
            title = strings.legendSource,
            helpText = strings.legendSourceHelp,
            helpContentDescription = strings.legendSourceAria,
        )
    }
}

@Composable
private fun SignalDiffTableBody(
    state: SignalDiffTableState,
    strings: SignalDiffTableStrings,
    visibleRows: List<SignalDiffRowVm>,
    hasAnyRows: Boolean,
    filterActive: Boolean,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    selected: Set<String>,
    onSelectedChange: (Set<String>) -> Unit,
    pinned: Set<String>,
    onTogglePin: (String) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        state.isError && !hasAnyRows ->
            QueryError(
                kind = state.errorKind ?: QueryErrorKind.Network,
                resourceName = strings.diffLabel,
                onRetry = onRetry,
                modifier = Modifier.fillMaxWidth(),
            )

        !state.isFetching && !hasAnyRows ->
            EmptyState(
                message = strings.emptyMessage,
                icon = DataDisplayGlyphs.ArrowRight,
                modifier = Modifier.fillMaxWidth(),
            )

        else ->
            SignalDiffDataTable(
                rows = visibleRows,
                strings = strings,
                isFetching = state.isFetching,
                filterActive = filterActive,
                sortState = sortState,
                onSortChange = onSortChange,
                selected = selected,
                onSelectedChange = onSelectedChange,
                pinned = pinned,
                onTogglePin = onTogglePin,
            )
    }
}

@Composable
private fun SignalDiffDataTable(
    rows: List<SignalDiffRowVm>,
    strings: SignalDiffTableStrings,
    isFetching: Boolean,
    filterActive: Boolean,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    selected: Set<String>,
    onSelectedChange: (Set<String>) -> Unit,
    pinned: Set<String>,
    onTogglePin: (String) -> Unit,
) {
    val emptyText =
        when {
            isFetching -> strings.loadingText
            filterActive -> strings.noMatchesMessage
            else -> strings.emptyMessage
        }
    DataTable(
        columns = diffColumns(strings, pinned, onTogglePin),
        rows = rows,
        keyOf = { it.name },
        sortState = sortState,
        onSortChange = onSortChange,
        selectable = true,
        selectedKeys = selected,
        onSelectedChange = { keys -> onSelectedChange(keys.mapTo(mutableSetOf()) { it.toString() }) },
        emptyText = emptyText,
        selectAllLabel = strings.selectAllLabel,
    )
}

/**
 * The seven-column layout the web `columns` array defines: a per-row pin toggle, the monospace `Signal`
 * (sortable), the right-aligned monospace `Window A` / `Window B` values, the colored sortable `Δ` cell, and
 * the `Src A` / `Src B` source-layer badges. Headers arrive already-localized.
 */
private fun diffColumns(
    strings: SignalDiffTableStrings,
    pinned: Set<String>,
    onTogglePin: (String) -> Unit,
): List<TableColumn<SignalDiffRowVm>> =
    listOf(
        TableColumn(key = COL_PIN, header = "", weight = WEIGHT_PIN) { row ->
            PinButton(
                pinned = pinned.contains(row.name),
                onToggle = { onTogglePin(row.name) },
                pinLabel = strings.pinLabel,
                pinnedLabel = strings.pinnedLabel,
                size = IconSize.Sm,
            )
        },
        TableColumn(key = COL_NAME, header = strings.colSignal, weight = WEIGHT_NAME, sortable = true) { CodeText(it.name) },
        TableColumn(key = COL_VALUE_A, header = strings.colValueA, weight = WEIGHT_VALUE, alignEnd = true) { CodeText(it.valueA) },
        TableColumn(key = COL_VALUE_B, header = strings.colValueB, weight = WEIGHT_VALUE, alignEnd = true) { CodeText(it.valueB) },
        TableColumn(key = COL_DELTA, header = strings.colDelta, weight = WEIGHT_DELTA, sortable = true, alignEnd = true) {
            DeltaCell(delta = it.delta, changedLabel = strings.deltaChanged)
        },
        TableColumn(key = COL_SOURCE_A, header = strings.colSourceA, weight = WEIGHT_SOURCE) {
            SourceLayerBadge(source = it.sourceA, ageMs = it.ageMsA)
        },
        TableColumn(key = COL_SOURCE_B, header = strings.colSourceB, weight = WEIGHT_SOURCE) {
            SourceLayerBadge(source = it.sourceB, ageMs = it.ageMsB)
        },
    )

/**
 * The Δ cell — the web `deltaLabel` render: an em dash when equal, the amber "changed" label for differing
 * non-numeric values, or the signed numeric delta + percent in a sign-toned monospace color.
 */
@Composable
private fun DeltaCell(
    delta: SignalDiffDelta,
    changedLabel: String,
) {
    when (delta) {
        SignalDiffDelta.None -> Caption(EM_DASH)
        SignalDiffDelta.Changed ->
            Text(text = changedLabel, style = MaterialTheme.typography.labelMedium, color = TeslaTokens.status.warning)
        is SignalDiffDelta.Numeric ->
            Text(
                text = delta.text,
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                color = deltaSignColor(delta.sign),
            )
    }
}

/** Sign-based tone for a numeric delta — positive success, negative danger, zero muted (web coloring). */
@Composable
@ReadOnlyComposable
private fun deltaSignColor(sign: DeltaSign): Color =
    when (sign) {
        DeltaSign.Positive -> TeslaTokens.status.success
        DeltaSign.Negative -> TeslaTokens.status.danger
        DeltaSign.Zero -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Resolves the localized [SignalDiffTableStrings] from the i18n catalog (P1/S10) — the `signalDiff.*` +
 * `help.signal.*` keys the web component reads via `t(...)`. Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
@Suppress("LongMethod")
private fun rememberSignalDiffTableStrings(): SignalDiffTableStrings {
    val colSignal = stringResource(R.string.translation_signalDiff_signal)
    val colValueA = stringResource(R.string.translation_signalDiff_valueA)
    val colValueB = stringResource(R.string.translation_signalDiff_valueB)
    val colDelta = stringResource(R.string.translation_signalDiff_delta)
    val colSourceA = stringResource(R.string.translation_signalDiff_sourceA)
    val colSourceB = stringResource(R.string.translation_signalDiff_sourceB)
    val deltaChanged = stringResource(R.string.translation_signalDiff_deltaChanged)
    val legendDelta = stringResource(R.string.translation_signalDiff_legend_delta)
    val legendDeltaHelp = stringResource(R.string.translation_help_signal_deltaCol)
    val legendDeltaAria = stringResource(R.string.translation_signalDiff_legend_deltaAria)
    val legendSource = stringResource(R.string.translation_signalDiff_legend_source)
    val legendSourceHelp = stringResource(R.string.translation_help_signal_sourceLayer)
    val legendSourceAria = stringResource(R.string.translation_signalDiff_legend_sourceAria)
    val emptyMessage = stringResource(R.string.translation_signalDiff_tableEmpty)
    val noMatchesMessage = stringResource(R.string.translation_signalDiff_tableNoMatches)
    val loadingText = stringResource(R.string.translation_signalDiff_tableLoading)
    val filterHint = stringResource(R.string.translation_signalDiff_filterPlaceholder) // parity:allow i18n key name
    val filterAria = stringResource(R.string.translation_signalDiff_filterPlaceholder) // parity:allow i18n key name
    val pinLabel = stringResource(R.string.translation_pin_pin)
    val pinnedLabel = stringResource(R.string.translation_pin_pinned)
    val selectAllLabel = stringResource(R.string.translation_table_selection_selectAll)
    val diffLabel = stringResource(R.string.translation_signalDiff_title)
    return remember(
        colSignal,
        colValueA,
        colValueB,
        colDelta,
        colSourceA,
        colSourceB,
        deltaChanged,
        legendDelta,
        legendDeltaHelp,
        legendDeltaAria,
        legendSource,
        legendSourceHelp,
        legendSourceAria,
        emptyMessage,
        noMatchesMessage,
        loadingText,
        filterHint,
        filterAria,
        pinLabel,
        pinnedLabel,
        selectAllLabel,
        diffLabel,
    ) {
        SignalDiffTableStrings(
            colSignal = colSignal,
            colValueA = colValueA,
            colValueB = colValueB,
            colDelta = colDelta,
            colSourceA = colSourceA,
            colSourceB = colSourceB,
            deltaChanged = deltaChanged,
            legendDelta = legendDelta,
            legendDeltaHelp = legendDeltaHelp,
            legendDeltaAria = legendDeltaAria,
            legendSource = legendSource,
            legendSourceHelp = legendSourceHelp,
            legendSourceAria = legendSourceAria,
            emptyMessage = emptyMessage,
            noMatchesMessage = noMatchesMessage,
            loadingText = loadingText,
            filterHint = filterHint,
            filterAria = filterAria,
            pinLabel = pinLabel,
            pinnedLabel = pinnedLabel,
            selectAllLabel = selectAllLabel,
            diffLabel = diffLabel,
        )
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    SignalDiffTableStrings(
        colSignal = "Signal",
        colValueA = "Window A",
        colValueB = "Window B",
        colDelta = "\u0394",
        colSourceA = "Src A",
        colSourceB = "Src B",
        deltaChanged = "changed",
        legendDelta = "\u0394",
        legendDeltaHelp = "Numeric difference (and percent change) between Window A and Window B for this signal.",
        legendDeltaAria = "More info about the \u0394 column",
        legendSource = "Src A / Src B",
        legendSourceHelp = "The layer that supplied this value: L1, L2, LOG, or STALE.",
        legendSourceAria = "More info about the source-layer column",
        emptyMessage = "No differences between the two snapshots",
        noMatchesMessage = "No signals match the current filter",
        loadingText = "Loading\u2026",
        filterHint = "Filter signals\u2026",
        filterAria = "Filter signals",
        pinLabel = "Pin",
        pinnedLabel = "Pinned",
        selectAllLabel = "Select all rows",
        diffLabel = "Signal Diff",
    )

private fun previewResponse(): SignalDiffServerResponse =
    SignalDiffServerResponse(
        vehicleId = 1L,
        atA = "2026-06-12T11:00:00Z",
        atB = "2026-06-12T12:00:00Z",
        count = 3L,
        data =
            listOf(
                SignalDiffRow(
                    name = "VehicleSpeed",
                    valueA = JsonPrimitive(40),
                    valueB = JsonPrimitive(64),
                    sourceA = "l1",
                    sourceB = "l2",
                    ageMsA = 1_200L,
                    ageMsB = 800L,
                    changed = true,
                ),
                SignalDiffRow(
                    name = "Gear",
                    valueA = JsonPrimitive("P"),
                    valueB = JsonPrimitive("D"),
                    sourceA = "log",
                    sourceB = "l1",
                    changed = true,
                ),
                SignalDiffRow(
                    name = "Locked",
                    valueA = JsonPrimitive(true),
                    valueB = JsonPrimitive(false),
                    sourceA = "stale",
                    sourceB = "l2",
                    changed = true,
                ),
            ),
    )

private fun previewState(
    response: SignalDiffServerResponse?,
    isFetching: Boolean = false,
    isError: Boolean = false,
    errorKind: QueryErrorKind? = null,
): SignalDiffTableState =
    SignalDiffTableState(
        response = response,
        updatedAtMillis = if (response != null || isError) 1L else null,
        isFetching = isFetching,
        isStale = false,
        isError = isError,
        errorKind = errorKind,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SignalDiffTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalDiffTableContent(previewState(response = null, isFetching = true), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SignalDiffTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalDiffTableContent(
            previewState(response = SignalDiffServerResponse(vehicleId = 1L, atA = "a", atB = "b", count = 0L)),
            PREVIEW_STRINGS,
            onRefresh = {},
        )
    }
}

@Preview(name = "Data", showBackground = true)
@Composable
private fun SignalDiffTableDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalDiffTableContent(previewState(response = previewResponse()), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SignalDiffTableErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalDiffTableContent(
            previewState(response = null, isError = true, errorKind = QueryErrorKind.Network),
            PREVIEW_STRINGS,
            onRefresh = {},
        )
    }
}
