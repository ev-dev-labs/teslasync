// The native Jetpack Compose + Material 3 LiveSignalsTable feature view — a parity port of
// web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx. The web component is the
// presentational tail of the Live Signal Inspector page: a filter `Input` over a sortable, paginated
// `DataTable` of the Redis-cached live snapshot, with a friendly empty state when the cache is empty. This
// native port keeps that composition and additionally surfaces the cache-then-network states the P3 contract
// mandates (loading / empty / error / stale / offline) by binding the shared Telemetry feed (P1/S8) through
// a [LiveSignalsTableViewModel]: a freshness chip + auto-refresh covers stale, a `QueryError` covers a hard
// failure with no cache, and the last-known rows stay visible while stale/offline. Values are the raw SI the
// backend serves (Phase-42); the view performs no HTTP. Every visible string resolves through the i18n
// catalog and the filter carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveSignalsTable) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignalstable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Cadence at which the per-row relative "Last update" labels re-render (web TimeStamp self-ticks). */
private const val RELATIVE_REFRESH_INTERVAL_MS = 30_000L

/**
 * Stateful entry point. Binds the shared Telemetry feed via [source] into a [LiveSignalsTableViewModel],
 * records the one-shot `view.opened` diagnostic, collects the projected [state], and renders. A host page
 * supplies the [source] (an adapter over the shared S7/S8 Telemetry layer), the selected [vehicleId] (web
 * parent's vehicle picker), and an optional [instanceKey] per placement.
 *
 * @param source the cache-then-network Telemetry seam (`TelemetryRepository`/`TelemetryStore` adapter).
 * @param vehicleId the selected vehicle; a non-positive id renders the empty state (web disabled query).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveSignalsTable(
    source: LiveSignalsTableSource,
    vehicleId: Long,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = LIVE_SIGNALS_TABLE_SLUG,
) {
    val viewModel: LiveSignalsTableViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { LiveSignalsTableViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberLiveSignalsTableStrings()

    LiveSignalsTableContent(
        state = state,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the filter field
 * (web's always-present `Input`); stale (non-error) data auto-refreshes (web 1s page poll). The body picks
 * the same branch the web ternary does, extended with the mandated error branch: a hard failure with no
 * cached rows shows `QueryError` with retry; an empty resolved cache shows the friendly empty state; anything
 * else shows the sortable, paginated table (its own footer message covers the loading and filtered-empty
 * sub-states). [onRefresh] backs the auto-refresh and the error retry.
 */
@Composable
fun LiveSignalsTableContent(
    state: LiveSignalsTableState,
    strings: LiveSignalsTableStrings,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.isStale, state.isFetching, state.isError) {
        if (state.isStale && !state.isFetching && !state.isError) onRefresh()
    }

    var filter by remember { mutableStateOf("") }
    var sortState by remember { mutableStateOf(SortState(key = COL_NAME, direction = SortDirection.Asc)) }
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(RELATIVE_REFRESH_INTERVAL_MS)
            nowMillis = System.currentTimeMillis()
        }
    }

    val allRows = remember(state.response) { LiveSignalsTableProjection.projectRows(state.response) }
    val visibleRows =
        remember(allRows, filter, sortState) {
            LiveSignalsTableProjection.sortRows(LiveSignalsTableProjection.filterRows(allRows, filter), sortState)
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        FilterHeader(
            filter = filter,
            onFilterChange = { filter = it },
            strings = strings,
            state = state,
        )
        LiveSignalsTableBody(
            state = state,
            strings = strings,
            visibleRows = visibleRows,
            hasAnyRows = allRows.isNotEmpty(),
            sortState = sortState,
            onSortChange = { key -> sortState = sortState.toggledBy(key) },
            onRetry = onRefresh,
            nowMillis = nowMillis,
        )
    }
}

@Composable
private fun FilterHeader(
    filter: String,
    onFilterChange: (String) -> Unit,
    strings: LiveSignalsTableStrings,
    state: LiveSignalsTableState,
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

@Composable
private fun LiveSignalsTableBody(
    state: LiveSignalsTableState,
    strings: LiveSignalsTableStrings,
    visibleRows: List<LiveSignalRow>,
    hasAnyRows: Boolean,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    onRetry: () -> Unit,
    nowMillis: Long,
) {
    when {
        state.isError && !hasAnyRows ->
            QueryError(
                kind = state.errorKind ?: QueryErrorKind.Network,
                resourceName = strings.snapshotLabel,
                onRetry = onRetry,
                modifier = Modifier.fillMaxWidth(),
            )

        !state.isFetching && !hasAnyRows ->
            EmptyState(
                title = strings.emptyTitle,
                message = strings.emptyMessage,
                icon = DataDisplayGlyphs.Wifi,
                modifier = Modifier.fillMaxWidth(),
            )

        else ->
            LiveSignalsDataTable(
                rows = visibleRows,
                strings = strings,
                isFetching = state.isFetching,
                sortState = sortState,
                onSortChange = onSortChange,
                nowMillis = nowMillis,
            )
    }
}

@Composable
private fun LiveSignalsDataTable(
    rows: List<LiveSignalRow>,
    strings: LiveSignalsTableStrings,
    isFetching: Boolean,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    nowMillis: Long,
) {
    val total = rows.size
    val pageCount = maxOf(1, (total + LIVE_SIGNALS_PAGE_SIZE - 1) / LIVE_SIGNALS_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * LIVE_SIGNALS_PAGE_SIZE
    val visible = if (total == 0) emptyList() else rows.subList(from, minOf(from + LIVE_SIGNALS_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            {
                Pagination(
                    page = current,
                    pageSize = LIVE_SIGNALS_PAGE_SIZE,
                    total = total,
                    onPageChange = { page = it },
                    firstLabel = firstLabel,
                    previousLabel = previousLabel,
                    nextLabel = nextLabel,
                    lastLabel = lastLabel,
                    showingText = { start, end, count ->
                        context.getString(R.string.translation_pagination_showing, start, end, count)
                    },
                )
            }
        } else {
            null
        }

    DataTable(
        columns = liveSignalsColumns(strings, nowMillis),
        rows = visible,
        keyOf = { it.name },
        sortState = sortState,
        onSortChange = onSortChange,
        emptyText = if (isFetching) strings.loadingText else strings.filteredText,
        footer = footer,
    )
}

/**
 * The three-column layout the web `columns` array defines — monospace `Signal` (sortable) + monospace
 * `Value` + relative `Last update` (sortable). Headers arrive already-localized; the timestamp cell renders
 * the shared relative label against [nowMillis], or the em dash when the row has no timestamp.
 */
private fun liveSignalsColumns(
    strings: LiveSignalsTableStrings,
    nowMillis: Long,
): List<TableColumn<LiveSignalRow>> =
    listOf(
        TableColumn(key = COL_NAME, header = strings.colName, sortable = true) { CodeText(it.name) },
        TableColumn(key = COL_VALUE, header = strings.colValue) { CodeText(it.value) },
        TableColumn(key = COL_TIMESTAMP, header = strings.colTimestamp, sortable = true) {
            TimestampCell(it.timestampMillis, nowMillis)
        },
    )

@Composable
private fun TimestampCell(
    millis: Long?,
    nowMillis: Long,
) {
    Caption(LiveSignalsTableProjection.relativeTimestampLabel(millis, nowMillis) ?: EM_DASH)
}

/**
 * Resolves the localized [LiveSignalsTableStrings] from the i18n catalog (P1/S10) — the `admin.liveSignals.*`
 * keys the web component reads via `t(...)`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberLiveSignalsTableStrings(): LiveSignalsTableStrings {
    val colName = stringResource(R.string.translation_admin_liveSignals_cols_name)
    val colValue = stringResource(R.string.translation_admin_liveSignals_cols_value)
    val colTimestamp = stringResource(R.string.translation_admin_liveSignals_cols_timestamp)
    val emptyTitle = stringResource(R.string.translation_admin_liveSignals_empty_title)
    val emptyMessage = stringResource(R.string.translation_admin_liveSignals_empty_message)
    val filterHint = stringResource(R.string.translation_admin_liveSignals_filterPlaceholder) // parity:allow i18n key name
    val filterAria = stringResource(R.string.translation_admin_liveSignals_filterAria)
    val loadingText = stringResource(R.string.translation_admin_liveSignals_table_loading)
    val filteredText = stringResource(R.string.translation_admin_liveSignals_table_filtered)
    val snapshotLabel = stringResource(R.string.translation_admin_liveSignals_panels_snapshot)
    return remember(
        colName,
        colValue,
        colTimestamp,
        emptyTitle,
        emptyMessage,
        filterHint,
        filterAria,
        loadingText,
        filteredText,
        snapshotLabel,
    ) {
        LiveSignalsTableStrings(
            colName = colName,
            colValue = colValue,
            colTimestamp = colTimestamp,
            emptyTitle = emptyTitle,
            emptyMessage = emptyMessage,
            filterHint = filterHint,
            filterAria = filterAria,
            loadingText = loadingText,
            filteredText = filteredText,
            snapshotLabel = snapshotLabel,
        )
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    LiveSignalsTableStrings(
        colName = "Signal",
        colValue = "Value",
        colTimestamp = "Last update",
        emptyTitle = "No live signals cached",
        emptyMessage = "Redis has no live snapshot for this vehicle yet.",
        filterHint = "Filter signal names\u2026",
        filterAria = "Filter signals",
        loadingText = "Loading\u2026",
        filteredText = "No signals match this filter.",
        snapshotLabel = "Live snapshot",
    )

private fun previewResponse(): VehicleLiveSignalsResponse =
    VehicleLiveSignalsResponse(
        vehicleId = 1L,
        signals =
            mapOf(
                "VehicleSpeed" to
                    buildJsonObject {
                        put("value", 64)
                        put("timestamp", "2026-06-11T11:59:40Z")
                    },
                "Gear" to JsonPrimitive("D"),
                "Locked" to
                    buildJsonObject {
                        put("value", true)
                        put("timestamp", "2026-06-11T11:58:00Z")
                    },
            ),
    )

private fun previewState(
    response: VehicleLiveSignalsResponse?,
    isFetching: Boolean = false,
    isError: Boolean = false,
    errorKind: QueryErrorKind? = null,
): LiveSignalsTableState =
    LiveSignalsTableState(
        response = response,
        updatedAtMillis = if (response != null || isError) 1L else null,
        isFetching = isFetching,
        isStale = false,
        isError = isError,
        errorKind = errorKind,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun LiveSignalsTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalsTableContent(previewState(response = null, isFetching = true), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun LiveSignalsTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalsTableContent(previewState(response = VehicleLiveSignalsResponse(vehicleId = 1L)), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Data", showBackground = true)
@Composable
private fun LiveSignalsTableDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalsTableContent(previewState(response = previewResponse()), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun LiveSignalsTableErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalsTableContent(
            previewState(response = null, isError = true, errorKind = QueryErrorKind.Network),
            PREVIEW_STRINGS,
            onRefresh = {},
        )
    }
}
