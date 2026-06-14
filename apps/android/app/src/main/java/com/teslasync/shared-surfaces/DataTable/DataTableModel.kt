// Pure, framework-free model + projection for the DataTable shared surface — the native analogue of everything the
// web component derives before it returns JSX (web/src/components/ui/DataTable.tsx). No Compose, no Android UI, no
// networking: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer (ADR-002).
//
// The web surface is a controlled, presentational table: `columns` + `data` (rows) come in as props and it renders a
// sortable header, optional select-all + per-row selection, optional row expansion, a CSV-export affordance, an
// empty message, a render-failure boundary, and an optional pagination footer. Its UI hooks are exactly the three
// the prompt lists: `useTranslation` (the i18n facade, P1/S10), `useVirtualizer` (row virtualization — the native
// counterpart is a LazyColumn, so no library is needed), and the co-exported `useSortToggle` (local sort state:
// re-clicking a column flips the direction, a new column selects descending-first). It performs NO data fetch — the
// parent list page owns the rows and any freshness/connectivity reporting.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9:
// documented, never silent — several templated states have no branch in a controlled surface, so they are reproduced
// as their faithful web behaviour or as a documented host-driven overlay rather than invented):
//   content  => one or more rows => the header + the virtualized row list (the web render).
//   empty    => zero rows => the centered `emptyMessage` (web `data.length === 0`), never a blank box.
//   error    => a row renderer threw / the host flags a failure => the "This table failed to render" panel
//               (web `SectionErrorBoundary` fallback). [DataTableBodyState.Error]
//   loading  => the host is fetching => skeleton/spinner chrome. The web DataTable has no loading branch (the parent
//               owns the fetch) but it is a natural table state and the atomic sibling exposes `loading`; included as
//               a host-driven flag so the surface is never a blank box while data resolves.
//   stale    => the host marks the rows older than its freshness window => a "Stale" chip ABOVE the content, content
//               still shown beneath (web parity: freshness is parent-owned; reproduced as a documented overlay using
//               the catalog `mqtt.stale` string). [DataTableFreshness.Stale]
//   offline  => the host has no connectivity => an "Offline" chip above the (cached) content (web parity: connectivity
//               is parent-owned; reproduced as a documented overlay using the catalog `common.offline` string).
//               [DataTableFreshness.Offline]
//
// The pure logic reuses the atomic, Compose-free primitives from `io.teslasync.android.components.ui` (the UiLogic
// file): [SortState] / [SortDirection] / [toggledBy] (the `useSortToggle` reducer), [togglePresence] (the
// selection/expansion set primitive), and [PaginationMath] (the footer arithmetic) — so the surface and the atomic
// DataTable share one tested behaviour (DRY).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DataTable — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges from
// the path — exactly as the sibling SortControl / ActiveFilterChips surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatable

import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.togglePresence
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no column header, row key, or any
 * user content — only this constant identifier — so a diagnostics line can never leak the operator's table data.
 */
const val DATA_TABLE_SLUG: String = "DataTable"

/**
 * The single body branch the table renders, in the priority the web component resolves them: a host fetch
 * ([Loading]) wins over a render failure ([Error]), which wins over a resolved-but-empty row set ([Empty]),
 * which falls through to the rows ([Content]). Pure so [DataTableProjection.bodyState] is unit-tested off-device.
 */
enum class DataTableBodyState { Loading, Error, Empty, Content }

/**
 * The freshness overlay the surface paints above the body (web parity: freshness/connectivity are parent-owned, so
 * this is a documented host-driven overlay rather than a web branch). [Live] paints nothing; [Stale] paints a
 * "Stale" chip; [Offline] paints an "Offline" chip — the content stays visible beneath either chip.
 */
enum class DataTableFreshness { Live, Stale, Offline }

/**
 * Tri-state of the select-all header checkbox — the web header `indeterminate` checkbox modelled as three explicit
 * states. [Off] = nothing in view selected; [On] = every in-view row selected; [Indeterminate] = a partial selection.
 */
enum class HeaderSelectionState { Off, On, Indeterminate }

/**
 * Pure column metadata — everything [DataTableProjection] needs about a column without touching its `@Composable`
 * cell renderer (which lives on `DataTableColumn` in the view file, keeping this model Compose-free and JVM-testable).
 *
 * @property key stable column identifier (web `Column.key`).
 * @property header the visible/spoken column title (web `Column.header`).
 * @property sortable whether the header is a sort toggle (web `Column.sortable`).
 * @property alignEnd right-align the cells, for numeric columns (web `Column.align === 'right'`).
 * @property defaultVisible whether the column shows by default (web `Column.defaultVisible`); hidden columns are
 *   dropped from the rendered set.
 * @property resizable whether the column carries a drag handle to adjust its width (web `resizable` + `Column`).
 */
data class DataTableColumnMeta(
    val key: String,
    val header: String,
    val sortable: Boolean = false,
    val alignEnd: Boolean = false,
    val defaultVisible: Boolean = true,
    val resizable: Boolean = false,
)

/**
 * The localized strings the surface folds into its output, resolved from `stringResource` at the render boundary
 * (tests pass a deterministic instance) so the projection helpers stay pure, locale-stable functions. Each maps 1:1
 * to a web `t()` call / catalog key (see [DataTableKeys]).
 *
 * @property selectRow per-row checkbox accessible name when unselected (web `table.selection.selectRow`).
 * @property deselectRow per-row checkbox accessible name when selected (web `table.selection.deselectRow`).
 * @property selectAllRows select-all header accessible name when not all selected (web `table.selection.selectAll`).
 * @property deselectAllRows select-all header accessible name when all selected (web `table.selection.deselectAll`).
 * @property expandRow expand-toggle accessible name when collapsed (web `table.expand.expand`).
 * @property collapseRow expand-toggle accessible name when expanded (web `table.expand.collapse`).
 * @property expandColumn the expand column header's accessible name (web `table.expand.column`).
 * @property exportCsvLabel the CSV button's accessible name (web `table.export.csv`, "Download table as CSV").
 * @property exportCsvButton the CSV button's visible label (web `table.export.csvButton`, "Download CSV").
 * @property errorTitle the render-failure panel title (web `errors.section.tableTitle`).
 * @property emptyMessage the empty-state message (web `emptyMessage`, default catalog `common.noData`).
 * @property staleLabel the stale freshness chip label (catalog `mqtt.stale`, "Stale").
 * @property offlineLabel the offline freshness chip label (catalog `common.offline`, "Offline").
 */
data class DataTableStrings(
    val selectRow: String,
    val deselectRow: String,
    val selectAllRows: String,
    val deselectAllRows: String,
    val expandRow: String,
    val collapseRow: String,
    val expandColumn: String,
    val exportCsvLabel: String,
    val exportCsvButton: String,
    val errorTitle: String,
    val emptyMessage: String,
    val staleLabel: String,
    val offlineLabel: String,
)

/**
 * The complete inventory of i18n keys the web DataTable references (every `t()` call), each mapped to its Android
 * catalog entry (P1/S10, `R.string.translation_<dotted_key>`). The render boundary resolves these via
 * `stringResource`; this list documents the contract and is asserted complete + unique by the model test.
 *
 * The per-column resize label [RESIZE_LABEL] is a parameterized key (`Resize column %1$s`) used as the drag handle's
 * accessible name; the remaining keys resolve to fixed strings carried in [DataTableStrings].
 */
object DataTableKeys {
    const val ERROR_TITLE: String = "errors.section.tableTitle"
    const val SELECT_ROW: String = "table.selection.selectRow"
    const val DESELECT_ROW: String = "table.selection.deselectRow"
    const val SELECT_ALL: String = "table.selection.selectAll"
    const val DESELECT_ALL: String = "table.selection.deselectAll"
    const val EXPAND_ROW: String = "table.expand.expand"
    const val COLLAPSE_ROW: String = "table.expand.collapse"
    const val EXPAND_COLUMN: String = "table.expand.column"
    const val EXPORT_CSV: String = "table.export.csv"
    const val EXPORT_CSV_BUTTON: String = "table.export.csvButton"
    const val RESIZE_LABEL: String = "table.columns.resizeLabel"

    /** Every key the web source references, in source order. */
    val ALL: List<String> =
        listOf(
            ERROR_TITLE,
            SELECT_ROW,
            DESELECT_ROW,
            SELECT_ALL,
            DESELECT_ALL,
            EXPAND_ROW,
            COLLAPSE_ROW,
            EXPAND_COLUMN,
            EXPORT_CSV,
            EXPORT_CSV_BUTTON,
            RESIZE_LABEL,
        )
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `DataTable` derives from its
 * props before it lays out the table: the [visibleColumns] (default-visible filtered, in caller order), the
 * resolved [bodyState], the leading-column flags ([showSelectionColumn] / [showExpandColumn]) and the resulting
 * [totalColumns] span, the select-all [headerSelectionState] + [selectedInViewCount], whether the toolbar shows
 * ([showToolbar]), and the freshness overlay flags ([isStale] / [isOffline]). Pure data so [DataTableProjection]
 * is unit-tested without a UI host.
 */
data class DataTableDisplay(
    val visibleColumns: List<DataTableColumnMeta>,
    val bodyState: DataTableBodyState,
    val rowCount: Int,
    val showSelectionColumn: Boolean,
    val showExpandColumn: Boolean,
    val totalColumns: Int,
    val headerSelectionState: HeaderSelectionState,
    val selectedInViewCount: Int,
    val hasSelection: Boolean,
    val exportable: Boolean,
    val showToolbar: Boolean,
    val freshness: DataTableFreshness,
) {
    /** True when a "Stale" freshness chip should paint above the content. */
    val isStale: Boolean get() = freshness == DataTableFreshness.Stale

    /** True when an "Offline" freshness chip should paint above the content. */
    val isOffline: Boolean get() = freshness == DataTableFreshness.Offline
}

/** Pure projection + selection/sort logic for the DataTable surface — the native port of the web derivations. */
object DataTableProjection {
    /** The rendered column set: drop columns the caller marked hidden, preserving caller order (web visibility). */
    fun visibleColumns(columns: List<DataTableColumnMeta>): List<DataTableColumnMeta> = columns.filter { it.defaultVisible }

    /**
     * Resolve the single body branch, in the web component's priority: a host fetch ([DataTableBodyState.Loading])
     * wins over a render failure ([DataTableBodyState.Error]), which wins over an empty row set
     * ([DataTableBodyState.Empty]), otherwise the rows render ([DataTableBodyState.Content]).
     */
    fun bodyState(
        loading: Boolean,
        error: Boolean,
        rowCount: Int,
    ): DataTableBodyState =
        when {
            loading -> DataTableBodyState.Loading
            error -> DataTableBodyState.Error
            rowCount <= 0 -> DataTableBodyState.Empty
            else -> DataTableBodyState.Content
        }

    /**
     * The tri-state of the select-all header — web `allSelected ? On : someSelected ? Indeterminate : Off`, computed
     * only over the rows currently in view so an out-of-view selection never forces the header On.
     */
    fun headerSelectionState(
        allKeys: Set<Any>,
        selectedKeys: Set<Any>,
    ): HeaderSelectionState {
        val inView = allKeys.intersect(selectedKeys)
        return when {
            inView.isEmpty() -> HeaderSelectionState.Off
            allKeys.isNotEmpty() && inView.size == allKeys.size -> HeaderSelectionState.On
            else -> HeaderSelectionState.Indeterminate
        }
    }

    /**
     * Toggle every in-view row: when the header is fully [HeaderSelectionState.On] the in-view keys are removed,
     * otherwise they are added — web `allSelected ? setSelection([]) : setSelection(allRowKeys)`, but additive so an
     * out-of-view selection is preserved.
     */
    fun toggleAll(
        allKeys: Set<Any>,
        selectedKeys: Set<Any>,
        headerState: HeaderSelectionState,
    ): Set<Any> = if (headerState == HeaderSelectionState.On) selectedKeys - allKeys else selectedKeys + allKeys

    /** Toggle one row's membership in the selection set — web `toggleRow` (the non-shift path). */
    fun toggleRow(
        selectedKeys: Set<Any>,
        key: Any,
    ): Set<Any> = selectedKeys.togglePresence(key)

    /** Toggle one row's membership in the expansion set — web `toggleExpand`. */
    fun toggleExpand(
        expandedKeys: Set<Any>,
        key: Any,
    ): Set<Any> = expandedKeys.togglePresence(key)

    /**
     * The `useSortToggle` reducer (web: re-clicking the active column flips the direction, a new column selects it
     * descending-first). Delegates to the shared atomic [toggledBy] so the surface and the atomic DataTable share
     * one tested behaviour.
     */
    fun sortToggle(
        state: SortState,
        key: String,
    ): SortState = state.toggledBy(key)

    /** The per-row checkbox accessible name (web `selected ? deselectRow : selectRow`). */
    fun selectionLabel(
        selected: Boolean,
        strings: DataTableStrings,
    ): String = if (selected) strings.deselectRow else strings.selectRow

    /** The select-all header accessible name (web `allSelected ? deselectAll : selectAll`). */
    fun selectAllLabel(
        headerState: HeaderSelectionState,
        strings: DataTableStrings,
    ): String = if (headerState == HeaderSelectionState.On) strings.deselectAllRows else strings.selectAllRows

    /** The expand-toggle accessible name (web `expanded ? collapse : expand`). */
    fun expandLabel(
        expanded: Boolean,
        strings: DataTableStrings,
    ): String = if (expanded) strings.collapseRow else strings.expandRow

    /** The freshness chip label, or `null` when the data is [DataTableFreshness.Live] (no chip). */
    fun freshnessLabel(
        freshness: DataTableFreshness,
        strings: DataTableStrings,
    ): String? =
        when (freshness) {
            DataTableFreshness.Live -> null
            DataTableFreshness.Stale -> strings.staleLabel
            DataTableFreshness.Offline -> strings.offlineLabel
        }

    /**
     * Fold the controlled props into the render-ready [DataTableDisplay]. Pure: the view reads the projected fields,
     * so every branch (leading columns, the total span, the toolbar visibility, the freshness flags) is unit-tested
     * off-device without a Compose host.
     */
    @Suppress("LongParameterList")
    fun project(
        columns: List<DataTableColumnMeta>,
        rowCount: Int,
        allKeys: Set<Any>,
        selectedKeys: Set<Any>,
        selectable: Boolean,
        expandable: Boolean,
        exportable: Boolean,
        loading: Boolean,
        error: Boolean,
        freshness: DataTableFreshness,
    ): DataTableDisplay {
        val visible = visibleColumns(columns)
        val headerState = if (selectable) headerSelectionState(allKeys, selectedKeys) else HeaderSelectionState.Off
        val selectedInView = if (selectable) allKeys.intersect(selectedKeys).size else 0
        val leading = (if (selectable) 1 else 0) + (if (expandable) 1 else 0)
        val hasSelection = selectedInView > 0
        return DataTableDisplay(
            visibleColumns = visible,
            bodyState = bodyState(loading, error, rowCount),
            rowCount = rowCount,
            showSelectionColumn = selectable,
            showExpandColumn = expandable,
            totalColumns = leading + visible.size,
            headerSelectionState = headerState,
            selectedInViewCount = selectedInView,
            hasSelection = hasSelection,
            exportable = exportable,
            showToolbar = exportable || hasSelection,
            freshness = freshness,
        )
    }
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never a column header, row key, or any user content — so a diagnostics line can never leak the
 * operator's table data. Kept free of Compose so the diagnostics contract is unit-tested with a recording [Logger].
 */
object DataTableDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = DATA_TABLE_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emit the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the composable's
     * first-composition effect; the surface guards it to once per placement.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
