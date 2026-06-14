// The native Jetpack Compose + Material 3 DataTable shared surface — a parity port of web/src/components/ui/DataTable.tsx.
// The web surface is a controlled, presentational table: `columns` + `data` (rows) come in as props and it renders a
// sortable header, an optional select-all + per-row selection, optional row expansion, a CSV-export affordance, an
// empty message, a render-failure boundary, and an optional pagination footer. Its three UI hooks are reproduced
// natively: `useTranslation` -> the i18n catalog resolved at this boundary (P1/S10); `useVirtualizer` -> a LazyColumn
// (the platform virtualizer, so no library is needed); and the co-exported `useSortToggle` -> [DataTableSortController]
// (local sort state — re-clicking a column flips the direction, a new column selects descending-first).
//
// All render decisions flow through the pure [DataTableProjection] / [DataTableDisplay] (which columns are visible,
// the body branch, the select-all tri-state, the toolbar visibility, the freshness flags) so the composable stays a
// thin render layer (ADR-002). Every visible/spoken string resolves through the i18n catalog (P1/S10) and every
// interactive element carries a TalkBack content description. The atomic chrome ([TriStateCheckbox], [Checkbox],
// [IconButton], [Button], [Badge], [DataTableBulkBar], [DataTableResizer], [Pagination], [EmptyState], the typography
// roles) is reused from the shared component library; this surface only composes it — no web Tailwind classes,
// platform design tokens only (P1/S9).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the templated loading / empty / content / error /
// stale / offline contract is mapped onto this controlled surface's real behaviour (see DataTableModel.kt). `content`
// is the header + the virtualized rows; `empty` is the centered message (never a blank box); `error` is the
// "This table failed to render" panel (the web `SectionErrorBoundary` fallback); `loading` is spinner chrome while a
// host fetch resolves; `stale` / `offline` are host-driven freshness chips painted above the (cached) content. The
// one-shot `view.opened` diagnostic is emitted on first composition (P1/S11), carrying only the surface slug.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatable

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.DataTableBulkBar
import io.teslasync.android.components.ui.DataTableResizer
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** UI-test tags for the body branches that have no text of their own to query. */
const val DATA_TABLE_LOADING_TAG: String = "datatable-loading"
const val DATA_TABLE_ERROR_TAG: String = "datatable-error"
const val DATA_TABLE_EMPTY_TAG: String = "datatable-empty"
const val DATA_TABLE_CONTENT_TAG: String = "datatable-content"

private val LEADING_COLUMN_WIDTH = 48.dp
private val DEFAULT_RESIZABLE_WIDTH = 140.dp
private val MAX_BODY_HEIGHT = 560.dp
private const val ROW_DIVIDER_ALPHA = 0.5f

/**
 * Column definition for the [DataTable] surface — the native port of the web `Column<T>`. A stable [key], a visible
 * [header], whether the header is [sortable], whether numeric cells [alignEnd], the flex [weight] (ignored when
 * [resizable]), whether the column shows by [defaultVisible], whether it carries a width drag handle ([resizable]),
 * and the [cell] renderer.
 */
data class DataTableColumn<T>(
    val key: String,
    val header: String,
    val sortable: Boolean = false,
    val alignEnd: Boolean = false,
    val weight: Float = 1f,
    val defaultVisible: Boolean = true,
    val resizable: Boolean = false,
    val cell: @Composable (T) -> Unit,
)

/** The Compose-free [DataTableColumnMeta] [DataTableProjection] reasons over (it never touches the [cell]). */
fun <T> DataTableColumn<T>.meta(): DataTableColumnMeta =
    DataTableColumnMeta(
        key = key,
        header = header,
        sortable = sortable,
        alignEnd = alignEnd,
        defaultVisible = defaultVisible,
        resizable = resizable,
    )

/**
 * The native `useSortToggle` — a local, hoistable sort-state holder. [sortState] is observable Compose state; [onSort]
 * applies the shared [DataTableProjection.sortToggle] reducer (re-click flips, new column selects descending-first).
 */
@Stable
class DataTableSortController(
    initial: SortState,
) {
    var sortState: SortState by mutableStateOf(initial)
        private set

    /** Re-click the active column to flip its direction, or select a new column descending-first. */
    fun onSort(key: String) {
        sortState = DataTableProjection.sortToggle(sortState, key)
    }
}

/** Remember a [DataTableSortController] across recompositions — the `useSortToggle` call site. */
@Composable
fun rememberDataTableSortController(
    initialKey: String? = null,
    initialDirection: SortDirection = SortDirection.Desc,
): DataTableSortController = remember { DataTableSortController(SortState(initialKey, initialDirection)) }

/**
 * Stateful entry point — the faithful port of the web `DataTable`. Resolves the localized [DataTableStrings] at the
 * render boundary (P1/S10), records the one-shot `view.opened` diagnostic (P1/S11), and renders the stateless
 * [DataTableContent]. Sort, selection and expansion state are hoisted so the host list page owns them; [logger]
 * defaults to the process logger so a host mounts the table with just its data + columns.
 */
@Composable
fun <T> DataTable(
    columns: List<DataTableColumn<T>>,
    rows: List<T>,
    keyOf: (T) -> Any,
    modifier: Modifier = Modifier,
    sortState: SortState = SortState(),
    onSort: (String) -> Unit = {},
    selectable: Boolean = false,
    selectedKeys: Set<Any> = emptySet(),
    onSelectedChange: (Set<Any>) -> Unit = {},
    expandable: Boolean = false,
    expandedKeys: Set<Any> = emptySet(),
    onExpandedChange: (Set<Any>) -> Unit = {},
    renderExpanded: (@Composable (T) -> Unit)? = null,
    loading: Boolean = false,
    error: Boolean = false,
    freshness: DataTableFreshness = DataTableFreshness.Live,
    exportable: Boolean = false,
    onExportCsv: () -> Unit = {},
    pageSize: Int? = null,
    emptyMessage: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DataTableDiagnostics.recordViewOpened(logger) }
    DataTableContent(
        columns = columns,
        rows = rows,
        keyOf = keyOf,
        strings = dataTableStrings(emptyMessage),
        modifier = modifier,
        sortState = sortState,
        onSort = onSort,
        selectable = selectable,
        selectedKeys = selectedKeys,
        onSelectedChange = onSelectedChange,
        expandable = expandable,
        expandedKeys = expandedKeys,
        onExpandedChange = onExpandedChange,
        renderExpanded = renderExpanded,
        loading = loading,
        error = error,
        freshness = freshness,
        exportable = exportable,
        onExportCsv = onExportCsv,
        pageSize = pageSize,
    )
}

/**
 * Stateless renderer — the unit/preview entry point. Projects the controlled props + [strings] through
 * [DataTableProjection], then lays out (top to bottom) the freshness chip, the selection/export toolbar, the
 * Surface-wrapped header + body (one of loading / error / empty / virtualized content), and the pagination footer.
 * Every interaction routes straight back through the hoisted callbacks.
 */
@Composable
fun <T> DataTableContent(
    columns: List<DataTableColumn<T>>,
    rows: List<T>,
    keyOf: (T) -> Any,
    strings: DataTableStrings,
    modifier: Modifier = Modifier,
    sortState: SortState = SortState(),
    onSort: (String) -> Unit = {},
    selectable: Boolean = false,
    selectedKeys: Set<Any> = emptySet(),
    onSelectedChange: (Set<Any>) -> Unit = {},
    expandable: Boolean = false,
    expandedKeys: Set<Any> = emptySet(),
    onExpandedChange: (Set<Any>) -> Unit = {},
    renderExpanded: (@Composable (T) -> Unit)? = null,
    loading: Boolean = false,
    error: Boolean = false,
    freshness: DataTableFreshness = DataTableFreshness.Live,
    exportable: Boolean = false,
    onExportCsv: () -> Unit = {},
    pageSize: Int? = null,
) {
    val allKeys = remember(rows, keyOf) { rows.map(keyOf).toSet() }
    val visibleCols = remember(columns) { columns.filter { it.defaultVisible } }
    val display =
        DataTableProjection.project(
            columns = columns.map { it.meta() },
            rowCount = rows.size,
            allKeys = allKeys,
            selectedKeys = selectedKeys,
            selectable = selectable,
            expandable = expandable,
            exportable = exportable,
            loading = loading,
            error = error,
            freshness = freshness,
        )
    val widths = remember { mutableStateMapOf<String, Dp>() }

    var page by remember { mutableIntStateOf(1) }
    LaunchedEffect(rows.size) { page = 1 }
    val pagedRows =
        if (pageSize != null && display.bodyState == DataTableBodyState.Content) {
            rows.slice(PaginationMath.sliceBounds(page, pageSize, rows.size))
        } else {
            rows
        }

    Column(modifier = modifier.fillMaxWidth()) {
        DataTableFreshnessChip(display, strings)
        if (display.showToolbar) {
            DataTableToolbar(
                display = display,
                strings = strings,
                selectedKeys = selectedKeys,
                allKeys = allKeys,
                onSelectedChange = onSelectedChange,
                onExportCsv = onExportCsv,
            )
        }
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                DataTableHeaderRow(
                    visibleColumns = visibleCols,
                    display = display,
                    strings = strings,
                    sortState = sortState,
                    onSort = onSort,
                    selectedKeys = selectedKeys,
                    allKeys = allKeys,
                    onSelectedChange = onSelectedChange,
                    widths = widths,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                DataTableBody(
                    state = display.bodyState,
                    strings = strings,
                    rows = pagedRows,
                    visibleColumns = visibleCols,
                    keyOf = keyOf,
                    selectable = selectable,
                    selectedKeys = selectedKeys,
                    onSelectedChange = onSelectedChange,
                    expandable = expandable,
                    expandedKeys = expandedKeys,
                    onExpandedChange = onExpandedChange,
                    renderExpanded = renderExpanded,
                    widths = widths,
                )
                if (pageSize != null && display.bodyState == DataTableBodyState.Content) {
                    DataTablePaginationFooter(page = page, pageSize = pageSize, total = rows.size, onPageChange = { page = it })
                }
            }
        }
    }
}

/** Resolves every fixed [DataTableStrings] entry from the P1/S10 catalog; [emptyOverride] wins for the empty text. */
@Composable
private fun dataTableStrings(emptyOverride: String?): DataTableStrings =
    DataTableStrings(
        selectRow = stringResource(R.string.translation_table_selection_selectRow),
        deselectRow = stringResource(R.string.translation_table_selection_deselectRow),
        selectAllRows = stringResource(R.string.translation_table_selection_selectAll),
        deselectAllRows = stringResource(R.string.translation_table_selection_deselectAll),
        expandRow = stringResource(R.string.translation_table_expand_expand),
        collapseRow = stringResource(R.string.translation_table_expand_collapse),
        expandColumn = stringResource(R.string.translation_table_expand_column),
        exportCsvLabel = stringResource(R.string.translation_table_export_csv),
        exportCsvButton = stringResource(R.string.translation_table_export_csvButton),
        errorTitle = stringResource(R.string.translation_errors_section_tableTitle),
        emptyMessage = emptyOverride ?: stringResource(R.string.translation_common_noData),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
    )

/** The stale / offline freshness chip painted above the content; renders nothing when the data is live. */
@Composable
private fun DataTableFreshnessChip(
    display: DataTableDisplay,
    strings: DataTableStrings,
) {
    val label = DataTableProjection.freshnessLabel(display.freshness, strings) ?: return
    Row(modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm)) {
        Badge(
            text = label,
            variant = if (display.isOffline) BadgeVariant.Danger else BadgeVariant.Warning,
            dot = true,
        )
    }
}

/** The selection bulk-bar + CSV-export affordance above the table (web toolbar row). */
@Composable
private fun DataTableToolbar(
    display: DataTableDisplay,
    strings: DataTableStrings,
    selectedKeys: Set<Any>,
    allKeys: Set<Any>,
    onSelectedChange: (Set<Any>) -> Unit,
    onExportCsv: () -> Unit,
) {
    val resources = LocalContext.current.resources
    val clearLabel = stringResource(R.string.translation_bulk_clear)
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f)) {
            DataTableBulkBar(
                count = display.selectedInViewCount,
                onClear = { onSelectedChange(selectedKeys - allKeys) },
                selectedText = { n -> resources.getQuantityString(R.plurals.translation_bulk_selected, n, n) },
                clearLabel = clearLabel,
            )
        }
        if (display.exportable) {
            Spacer(Modifier.width(Spacing.sm))
            Button(
                label = strings.exportCsvButton,
                onClick = onExportCsv,
                modifier = Modifier.semantics { contentDescription = strings.exportCsvLabel },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = FeedbackGlyphs.Download,
            )
        }
    }
}

/** The header row: the select-all tri-state, the optional expand-column header, and the sortable column headers. */
@Composable
private fun <T> DataTableHeaderRow(
    visibleColumns: List<DataTableColumn<T>>,
    display: DataTableDisplay,
    strings: DataTableStrings,
    sortState: SortState,
    onSort: (String) -> Unit,
    selectedKeys: Set<Any>,
    allKeys: Set<Any>,
    onSelectedChange: (Set<Any>) -> Unit,
    widths: MutableMap<String, Dp>,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (display.showSelectionColumn) {
            Box(modifier = Modifier.width(LEADING_COLUMN_WIDTH), contentAlignment = Alignment.CenterStart) {
                TriStateCheckbox(
                    state = display.headerSelectionState.toToggleableState(),
                    onClick = {
                        onSelectedChange(
                            DataTableProjection.toggleAll(allKeys, selectedKeys, display.headerSelectionState),
                        )
                    },
                    modifier =
                        Modifier.semantics {
                            contentDescription = DataTableProjection.selectAllLabel(display.headerSelectionState, strings)
                        },
                )
            }
        }
        if (display.showExpandColumn) {
            Box(
                modifier =
                    Modifier
                        .width(LEADING_COLUMN_WIDTH)
                        .semantics { contentDescription = strings.expandColumn },
            )
        }
        visibleColumns.forEach { column ->
            DataTableHeaderCell(column = column, sortState = sortState, onSort = onSort, widths = widths)
        }
    }
}

/** A single header cell — a fixed width + drag handle when resizable, else a flex-weighted, optionally sortable label. */
@Composable
private fun <T> RowScope.DataTableHeaderCell(
    column: DataTableColumn<T>,
    sortState: SortState,
    onSort: (String) -> Unit,
    widths: MutableMap<String, Dp>,
) {
    if (column.resizable) {
        val width = widths[column.key] ?: DEFAULT_RESIZABLE_WIDTH
        Box(modifier = Modifier.width(width)) {
            DataTableHeaderLabel(column, sortState, onSort, Modifier.fillMaxWidth())
            DataTableResizer(
                width = width,
                onWidthChange = { widths[column.key] = it },
                contentDescription = stringResource(R.string.translation_table_columns_resizeLabel, column.header),
                modifier = Modifier.align(Alignment.CenterEnd),
            )
        }
    } else {
        DataTableHeaderLabel(column, sortState, onSort, Modifier.weight(column.weight))
    }
}

/** The label + sort-direction chevron for one header cell; clickable when the column is sortable. */
@Composable
private fun <T> DataTableHeaderLabel(
    column: DataTableColumn<T>,
    sortState: SortState,
    onSort: (String) -> Unit,
    modifier: Modifier,
) {
    Row(
        modifier = if (column.sortable) modifier.clickable { onSort(column.key) } else modifier,
        horizontalArrangement = if (column.alignEnd) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FieldLabelText(column.header)
        if (sortState.key == column.key) {
            Spacer(Modifier.width(Spacing.xs))
            Icon(
                imageVector = if (sortState.direction == SortDirection.Asc) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Xs,
            )
        }
    }
}

/** The body — one of the four mutually-exclusive branches; content uses a bounded LazyColumn (the web virtualizer). */
@Composable
private fun <T> DataTableBody(
    state: DataTableBodyState,
    strings: DataTableStrings,
    rows: List<T>,
    visibleColumns: List<DataTableColumn<T>>,
    keyOf: (T) -> Any,
    selectable: Boolean,
    selectedKeys: Set<Any>,
    onSelectedChange: (Set<Any>) -> Unit,
    expandable: Boolean,
    expandedKeys: Set<Any>,
    onExpandedChange: (Set<Any>) -> Unit,
    renderExpanded: (@Composable (T) -> Unit)?,
    widths: MutableMap<String, Dp>,
) {
    when (state) {
        DataTableBodyState.Loading ->
            Box(
                modifier = Modifier.fillMaxWidth().padding(Spacing.xl3).testTag(DATA_TABLE_LOADING_TAG),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

        DataTableBodyState.Error ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(Spacing.xl2).testTag(DATA_TABLE_ERROR_TAG),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.danger)
                Spacer(Modifier.width(Spacing.sm))
                BodyText(strings.errorTitle)
            }

        DataTableBodyState.Empty ->
            EmptyState(message = strings.emptyMessage, modifier = Modifier.testTag(DATA_TABLE_EMPTY_TAG))

        DataTableBodyState.Content ->
            Box(modifier = Modifier.heightIn(max = MAX_BODY_HEIGHT).testTag(DATA_TABLE_CONTENT_TAG)) {
                LazyColumn(modifier = Modifier.fillMaxWidth()) {
                    items(rows, key = { keyOf(it) }) { row ->
                        val key = keyOf(row)
                        DataTableBodyRow(
                            row = row,
                            visibleColumns = visibleColumns,
                            strings = strings,
                            selectable = selectable,
                            selected = key in selectedKeys,
                            onToggleRow = { onSelectedChange(DataTableProjection.toggleRow(selectedKeys, key)) },
                            expandable = expandable,
                            expanded = key in expandedKeys,
                            onToggleExpand = { onExpandedChange(DataTableProjection.toggleExpand(expandedKeys, key)) },
                            renderExpanded = renderExpanded,
                            widths = widths,
                        )
                        HorizontalDivider(
                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = ROW_DIVIDER_ALPHA),
                        )
                    }
                }
            }
    }
}

/** One body row: the optional selection checkbox + expand toggle, the weighted cells, and the optional drawer. */
@Composable
private fun <T> DataTableBodyRow(
    row: T,
    visibleColumns: List<DataTableColumn<T>>,
    strings: DataTableStrings,
    selectable: Boolean,
    selected: Boolean,
    onToggleRow: () -> Unit,
    expandable: Boolean,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    renderExpanded: (@Composable (T) -> Unit)?,
    widths: MutableMap<String, Dp>,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (selectable) {
                Box(modifier = Modifier.width(LEADING_COLUMN_WIDTH), contentAlignment = Alignment.CenterStart) {
                    Checkbox(
                        checked = selected,
                        onCheckedChange = { onToggleRow() },
                        modifier =
                            Modifier.semantics {
                                contentDescription = DataTableProjection.selectionLabel(selected, strings)
                            },
                    )
                }
            }
            if (expandable) {
                Box(modifier = Modifier.width(LEADING_COLUMN_WIDTH), contentAlignment = Alignment.CenterStart) {
                    IconButton(
                        imageVector = if (expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
                        contentDescription = DataTableProjection.expandLabel(expanded, strings),
                        onClick = onToggleExpand,
                        size = IconSize.Sm,
                    )
                }
            }
            visibleColumns.forEach { column -> DataTableBodyCell(column = column, row = row, widths = widths) }
        }
        if (expandable && expanded && renderExpanded != null) {
            Box(
                modifier = Modifier.fillMaxWidth().padding(start = Spacing.xl3, end = Spacing.md, bottom = Spacing.sm),
            ) { renderExpanded(row) }
        }
    }
}

/** One body cell — a fixed width when its column is resizable, otherwise flex-weighted to mirror the header. */
@Composable
private fun <T> RowScope.DataTableBodyCell(
    column: DataTableColumn<T>,
    row: T,
    widths: MutableMap<String, Dp>,
) {
    val cellModifier =
        if (column.resizable) Modifier.width(widths[column.key] ?: DEFAULT_RESIZABLE_WIDTH) else Modifier.weight(column.weight)
    Box(
        modifier = cellModifier,
        contentAlignment = if (column.alignEnd) Alignment.CenterEnd else Alignment.CenterStart,
    ) { column.cell(row) }
}

/** The pagination footer — the atomic [Pagination] wired to the catalog labels + the localized "showing" summary. */
@Composable
private fun DataTablePaginationFooter(
    page: Int,
    pageSize: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val resources = LocalContext.current.resources
    Box(modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm)) {
        Pagination(
            page = page,
            pageSize = pageSize,
            total = total,
            onPageChange = onPageChange,
            firstLabel = stringResource(R.string.translation_pagination_first),
            previousLabel = stringResource(R.string.translation_pagination_previous),
            nextLabel = stringResource(R.string.translation_pagination_next),
            lastLabel = stringResource(R.string.translation_pagination_last),
            showingText = { start, end, count ->
                resources.getString(R.string.translation_pagination_showing, start, end, count)
            },
        )
    }
}

/** Maps the surface's [HeaderSelectionState] onto the Material [ToggleableState] the [TriStateCheckbox] consumes. */
private fun HeaderSelectionState.toToggleableState(): ToggleableState =
    when (this) {
        HeaderSelectionState.On -> ToggleableState.On
        HeaderSelectionState.Off -> ToggleableState.Off
        HeaderSelectionState.Indeterminate -> ToggleableState.Indeterminate
    }

private val previewStrings =
    DataTableStrings(
        selectRow = "Select row",
        deselectRow = "Deselect row",
        selectAllRows = "Select all rows",
        deselectAllRows = "Deselect all rows",
        expandRow = "Expand row",
        collapseRow = "Collapse row",
        expandColumn = "Expand row",
        exportCsvLabel = "Download table as CSV",
        exportCsvButton = "Download CSV",
        errorTitle = "This table failed to render",
        emptyMessage = "No data available",
        staleLabel = "Stale",
        offlineLabel = "Offline",
    )

private data class PreviewRow(
    val id: Int,
    val name: String,
    val distance: String,
)

private val previewColumns =
    listOf(
        DataTableColumn<PreviewRow>(key = "name", header = "Name", sortable = true) { BodyText(it.name) },
        DataTableColumn<PreviewRow>(key = "distance", header = "Distance", alignEnd = true) { BodyText(it.distance) },
    )

private val previewRows =
    listOf(
        PreviewRow(1, "Morning commute", "18 km"),
        PreviewRow(2, "Supercharger run", "62 km"),
        PreviewRow(3, "Weekend trip", "240 km"),
    )

@Preview(name = "DataTable — content", showBackground = true)
@Composable
private fun DataTableContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DataTableContent(
            columns = previewColumns,
            rows = previewRows,
            keyOf = { it.id },
            strings = previewStrings,
            sortState = SortState("name", SortDirection.Asc),
            selectable = true,
            selectedKeys = setOf(1),
            exportable = true,
        )
    }
}

@Preview(name = "DataTable — empty", showBackground = true)
@Composable
private fun DataTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DataTableContent(
            columns = previewColumns,
            rows = emptyList(),
            keyOf = { it.id },
            strings = previewStrings,
        )
    }
}

@Preview(name = "DataTable — offline", showBackground = true)
@Composable
private fun DataTableOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DataTableContent(
            columns = previewColumns,
            rows = previewRows,
            keyOf = { it.id },
            strings = previewStrings,
            freshness = DataTableFreshness.Offline,
        )
    }
}
