// Off-device unit tests for the pure DataTable model: the visible-column filter, the loading/error/empty/content body
// priority, the select-all tri-state + the toggle-all/-row/-expand set reducers, the `useSortToggle` sort reducer, the
// per-element accessibility labels, the full props -> display projection, the i18n key inventory (every web `t()` this
// surface makes), the diagnostics slug, and the PII-safe `view.opened` diagnostic. Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android.

package io.teslasync.android.sharedsurfaces.datatable

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DataTableModelTest {
    private val strings =
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

    private val columns =
        listOf(
            DataTableColumnMeta(key = "name", header = "Name", sortable = true),
            DataTableColumnMeta(key = "distance", header = "Distance", alignEnd = true),
            DataTableColumnMeta(key = "secret", header = "Secret", defaultVisible = false),
        )

    private val allKeys: Set<Any> = setOf("a", "b", "c")

    // ── visible columns (web column-visibility filter) ──────────────────────────────────────────────────────────
    @Test
    fun visibleColumnsDropsHiddenColumnsPreservingOrder() {
        val visible = DataTableProjection.visibleColumns(columns)
        assertEquals(listOf("name", "distance"), visible.map { it.key })
    }

    // ── body state priority (web loading > error > empty > content) ─────────────────────────────────────────────
    @Test
    fun bodyStateResolvesInPriorityOrder() {
        assertEquals(DataTableBodyState.Loading, DataTableProjection.bodyState(loading = true, error = true, rowCount = 5))
        assertEquals(DataTableBodyState.Error, DataTableProjection.bodyState(loading = false, error = true, rowCount = 5))
        assertEquals(DataTableBodyState.Empty, DataTableProjection.bodyState(loading = false, error = false, rowCount = 0))
        assertEquals(DataTableBodyState.Content, DataTableProjection.bodyState(loading = false, error = false, rowCount = 5))
    }

    // ── select-all tri-state (web allSelected / someSelected / none) ────────────────────────────────────────────
    @Test
    fun headerSelectionStateClassifiesOffPartialAndAll() {
        assertEquals(HeaderSelectionState.Off, DataTableProjection.headerSelectionState(allKeys, emptySet()))
        assertEquals(HeaderSelectionState.Indeterminate, DataTableProjection.headerSelectionState(allKeys, setOf("a")))
        assertEquals(HeaderSelectionState.On, DataTableProjection.headerSelectionState(allKeys, allKeys))
    }

    @Test
    fun headerSelectionStateIgnoresOutOfViewSelection() {
        // "z" is selected but not in view — the header must not read as fully On.
        assertEquals(HeaderSelectionState.Off, DataTableProjection.headerSelectionState(allKeys, setOf("z")))
    }

    // ── toggle-all (web allSelected ? clear : selectAll, additive) ──────────────────────────────────────────────
    @Test
    fun toggleAllAddsWhenNotFullySelected() {
        val next = DataTableProjection.toggleAll(allKeys, setOf("a"), HeaderSelectionState.Indeterminate)
        assertEquals(allKeys, next)
    }

    @Test
    fun toggleAllRemovesInViewKeysWhenFullySelectedPreservingOthers() {
        val next = DataTableProjection.toggleAll(allKeys, allKeys + "z", HeaderSelectionState.On)
        assertEquals(setOf<Any>("z"), next)
    }

    // ── per-row / per-expand toggles (web toggleRow / toggleExpand) ─────────────────────────────────────────────
    @Test
    fun toggleRowAddsThenRemoves() {
        val added = DataTableProjection.toggleRow(emptySet(), "a")
        assertEquals(setOf<Any>("a"), added)
        assertEquals(emptySet<Any>(), DataTableProjection.toggleRow(added, "a"))
    }

    @Test
    fun toggleExpandAddsThenRemoves() {
        val added = DataTableProjection.toggleExpand(emptySet(), "row-1")
        assertEquals(setOf<Any>("row-1"), added)
        assertEquals(emptySet<Any>(), DataTableProjection.toggleExpand(added, "row-1"))
    }

    // ── useSortToggle reducer (re-click flips, new column selects descending-first) ─────────────────────────────
    @Test
    fun sortToggleFlipsActiveColumnAndSelectsNewColumnDescending() {
        val initial = SortState(key = "name", direction = SortDirection.Desc)
        val flipped = DataTableProjection.sortToggle(initial, "name")
        assertEquals(SortState("name", SortDirection.Asc), flipped)

        val switched = DataTableProjection.sortToggle(flipped, "distance")
        assertEquals(SortState("distance", SortDirection.Desc), switched)
    }

    // ── accessibility labels (web aria-label branches) ──────────────────────────────────────────────────────────
    @Test
    fun selectionLabelReflectsSelectedState() {
        assertEquals("Select row", DataTableProjection.selectionLabel(selected = false, strings))
        assertEquals("Deselect row", DataTableProjection.selectionLabel(selected = true, strings))
    }

    @Test
    fun selectAllLabelReflectsHeaderState() {
        assertEquals("Select all rows", DataTableProjection.selectAllLabel(HeaderSelectionState.Off, strings))
        assertEquals("Select all rows", DataTableProjection.selectAllLabel(HeaderSelectionState.Indeterminate, strings))
        assertEquals("Deselect all rows", DataTableProjection.selectAllLabel(HeaderSelectionState.On, strings))
    }

    @Test
    fun expandLabelReflectsExpandedState() {
        assertEquals("Expand row", DataTableProjection.expandLabel(expanded = false, strings))
        assertEquals("Collapse row", DataTableProjection.expandLabel(expanded = true, strings))
    }

    @Test
    fun freshnessLabelIsNullWhenLiveAndSetOtherwise() {
        assertNull(DataTableProjection.freshnessLabel(DataTableFreshness.Live, strings))
        assertEquals("Stale", DataTableProjection.freshnessLabel(DataTableFreshness.Stale, strings))
        assertEquals("Offline", DataTableProjection.freshnessLabel(DataTableFreshness.Offline, strings))
    }

    // ── projection: content with selection + export ─────────────────────────────────────────────────────────────
    @Test
    fun projectComposesLeadingColumnsToolbarAndSelectionCount() {
        val display =
            DataTableProjection.project(
                columns = columns,
                rowCount = 3,
                allKeys = allKeys,
                selectedKeys = setOf("a", "b"),
                selectable = true,
                expandable = true,
                exportable = true,
                loading = false,
                error = false,
                freshness = DataTableFreshness.Live,
            )

        assertEquals(listOf("name", "distance"), display.visibleColumns.map { it.key })
        assertEquals(DataTableBodyState.Content, display.bodyState)
        assertTrue(display.showSelectionColumn)
        assertTrue(display.showExpandColumn)
        // 2 visible columns + selection + expand leading columns.
        assertEquals(4, display.totalColumns)
        assertEquals(HeaderSelectionState.Indeterminate, display.headerSelectionState)
        assertEquals(2, display.selectedInViewCount)
        assertTrue(display.hasSelection)
        assertTrue(display.showToolbar)
        assertFalse(display.isStale)
        assertFalse(display.isOffline)
    }

    // ── projection: empty + no selection => toolbar hidden unless exportable ────────────────────────────────────
    @Test
    fun projectHidesToolbarWithoutSelectionOrExport() {
        val display =
            DataTableProjection.project(
                columns = columns,
                rowCount = 0,
                allKeys = emptySet(),
                selectedKeys = emptySet(),
                selectable = true,
                expandable = false,
                exportable = false,
                loading = false,
                error = false,
                freshness = DataTableFreshness.Live,
            )

        assertEquals(DataTableBodyState.Empty, display.bodyState)
        assertFalse(display.hasSelection)
        assertFalse(display.showToolbar)
        // Only the selection leading column (no expand) + 2 visible columns.
        assertEquals(3, display.totalColumns)
    }

    @Test
    fun projectExposesExportableToolbarEvenWithoutSelection() {
        val display =
            DataTableProjection.project(
                columns = columns,
                rowCount = 3,
                allKeys = allKeys,
                selectedKeys = emptySet(),
                selectable = false,
                expandable = false,
                exportable = true,
                loading = false,
                error = false,
                freshness = DataTableFreshness.Live,
            )
        assertTrue(display.exportable)
        assertTrue(display.showToolbar)
        assertFalse(display.showSelectionColumn)
        assertEquals(0, display.selectedInViewCount)
    }

    // ── projection: freshness overlay flags ─────────────────────────────────────────────────────────────────────
    @Test
    fun projectFlagsStaleAndOfflineFreshness() {
        val stale =
            DataTableProjection.project(
                columns,
                3,
                allKeys,
                emptySet(),
                selectable = false,
                expandable = false,
                exportable = false,
                loading = false,
                error = false,
                freshness = DataTableFreshness.Stale,
            )
        assertTrue(stale.isStale)
        assertFalse(stale.isOffline)

        val offline =
            DataTableProjection.project(
                columns,
                3,
                allKeys,
                emptySet(),
                selectable = false,
                expandable = false,
                exportable = false,
                loading = false,
                error = false,
                freshness = DataTableFreshness.Offline,
            )
        assertTrue(offline.isOffline)
        assertFalse(offline.isStale)
    }

    // ── i18n inventory (every web t(key) this surface makes) ────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndCorrectlyNamespaced() {
        assertEquals(11, DataTableKeys.ALL.size)
        assertEquals(DataTableKeys.ALL.size, DataTableKeys.ALL.toSet().size)
        assertTrue(DataTableKeys.ALL.all { it.startsWith("table.") || it.startsWith("errors.") })
        assertTrue(
            DataTableKeys.ALL.containsAll(
                listOf(
                    DataTableKeys.ERROR_TITLE,
                    DataTableKeys.SELECT_ROW,
                    DataTableKeys.DESELECT_ROW,
                    DataTableKeys.SELECT_ALL,
                    DataTableKeys.DESELECT_ALL,
                    DataTableKeys.EXPAND_ROW,
                    DataTableKeys.COLLAPSE_ROW,
                    DataTableKeys.EXPAND_COLUMN,
                    DataTableKeys.EXPORT_CSV,
                    DataTableKeys.EXPORT_CSV_BUTTON,
                    DataTableKeys.RESIZE_LABEL,
                ),
            ),
        )
    }

    // ── telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPii() {
        assertEquals("DataTable", DATA_TABLE_SLUG)
        assertEquals("DataTable", DataTableDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        DataTableDiagnostics.recordViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "DataTable"), opened.second)
    }

    /** A [Logger] that records every emitted record, so tests can assert the diagnostics contract (P1/S11). */
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
