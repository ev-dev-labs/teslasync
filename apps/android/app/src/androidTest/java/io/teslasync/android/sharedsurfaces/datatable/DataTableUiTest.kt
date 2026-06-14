package io.teslasync.android.sharedsurfaces.datatable

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DataTable] + [DataTableContent] across the states the web
 * component renders: the virtualized content rows, the empty message, the render-failure panel, the loading chrome,
 * the stale/offline freshness chips, the select-all + per-row selection, the row expansion, and the CSV-export
 * affordance. Asserts the rendered i18n strings and the TalkBack content descriptions on every interactive element,
 * and that the stateful entry emits the one-shot `view.opened` diagnostic. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the projection + diagnostics logic, this covers the render.
 */
class DataTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private data class Row(
        val id: Int,
        val name: String,
        val distance: String,
    )

    private val strings =
        DataTableStrings(
            selectRow = "Select row",
            deselectRow = "Deselect row",
            selectAllRows = "Select all rows",
            deselectAllRows = "Deselect all rows",
            expandRow = "Expand row",
            collapseRow = "Collapse row",
            expandColumn = "Expand column",
            exportCsvLabel = "Download table as CSV",
            exportCsvButton = "Download CSV",
            errorTitle = "This table failed to render",
            emptyMessage = "No data available",
            staleLabel = "Stale",
            offlineLabel = "Offline",
        )

    private val columns =
        listOf(
            DataTableColumn<Row>(key = "name", header = "Name", sortable = true) { BodyText(it.name) },
            DataTableColumn<Row>(key = "distance", header = "Distance", alignEnd = true) { BodyText(it.distance) },
        )

    private val rows =
        listOf(
            Row(1, "Morning commute", "18 km"),
            Row(2, "Supercharger run", "62 km"),
            Row(3, "Weekend trip", "240 km"),
        )

    // ── content ─────────────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun contentShowsHeadersAndCells() {
        setContent(rows = rows)
        compose.onNodeWithTag(DATA_TABLE_CONTENT_TAG).assertIsDisplayed()
        compose.onNodeWithText("Name").assertIsDisplayed()
        compose.onNodeWithText("Morning commute").assertIsDisplayed()
        compose.onNodeWithText("240 km").assertIsDisplayed()
    }

    // ── empty ───────────────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun emptyStateShowsMessageNeverABlankBox() {
        setContent(rows = emptyList())
        compose.onNodeWithTag(DATA_TABLE_EMPTY_TAG).assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    // ── error ───────────────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun errorStateShowsFailureTitle() {
        setContent(rows = rows, error = true)
        compose.onNodeWithTag(DATA_TABLE_ERROR_TAG).assertIsDisplayed()
        compose.onNodeWithText("This table failed to render").assertIsDisplayed()
    }

    // ── loading ─────────────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun loadingStateShowsSpinnerChrome() {
        setContent(rows = emptyList(), loading = true)
        compose.onNodeWithTag(DATA_TABLE_LOADING_TAG).assertIsDisplayed()
    }

    // ── stale / offline freshness chips ─────────────────────────────────────────────────────────────────────────
    @Test
    fun staleFreshnessShowsStaleChipOverContent() {
        setContent(rows = rows, freshness = DataTableFreshness.Stale)
        compose.onNodeWithText("Stale").assertIsDisplayed()
        compose.onNodeWithText("Morning commute").assertIsDisplayed()
    }

    @Test
    fun offlineFreshnessShowsOfflineChipOverContent() {
        setContent(rows = rows, freshness = DataTableFreshness.Offline)
        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Supercharger run").assertIsDisplayed()
    }

    // ── selection (select-all + per-row) ────────────────────────────────────────────────────────────────────────
    @Test
    fun selectAllExposesAccessibleNameAndSelectsEveryRow() {
        var selected: Set<Any> = emptySet()
        setContent(rows = rows, selectable = true, onSelectedChange = { selected = it })
        compose.onNodeWithContentDescription("Select all rows").assertIsDisplayed().performClick()
        assertEquals(setOf<Any>(1, 2, 3), selected)
    }

    @Test
    fun perRowCheckboxExposesSelectLabelAndToggles() {
        var selected: Set<Any> = emptySet()
        setContent(rows = rows, selectable = true, onSelectedChange = { selected = it })
        compose.onAllNodesWithContentDescription("Select row").onFirst().performClick()
        assertEquals(setOf<Any>(1), selected)
    }

    // ── expansion ───────────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun expandToggleExposesAccessibleNameAndExpandsRow() {
        var expanded: Set<Any> = emptySet()
        setContent(
            rows = rows,
            expandable = true,
            onExpandedChange = { expanded = it },
            renderExpanded = { BodyText("Detail ${it.id}") },
        )
        // The header expand column is labelled "Expand column"; only the per-row toggles say "Expand row".
        compose.onAllNodesWithContentDescription("Expand row").onFirst().performClick()
        assertEquals(setOf<Any>(1), expanded)
    }

    // ── export affordance ───────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun exportButtonShowsVisibleLabelAndAccessibleName() {
        setContent(rows = rows, exportable = true)
        compose.onNodeWithText("Download CSV").assertIsDisplayed()
        compose.onNodeWithContentDescription("Download table as CSV").assertIsDisplayed()
    }

    // ── pagination ──────────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun paginationShowsLocalizedSummary() {
        setContent(rows = rows, pageSize = 2)
        compose.onNodeWithText("of 3", substring = true).assertIsDisplayed()
    }

    // ── diagnostics (P1/S11) ────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun statefulEntryEmitsViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DataTable(
                    columns = columns,
                    rows = rows,
                    keyOf = { it.id },
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertTrue(opened.single().second == mapOf("surface" to "DataTable"))
    }

    @Suppress("LongParameterList")
    private fun setContent(
        rows: List<Row>,
        selectable: Boolean = false,
        onSelectedChange: (Set<Any>) -> Unit = {},
        expandable: Boolean = false,
        onExpandedChange: (Set<Any>) -> Unit = {},
        renderExpanded: (@androidx.compose.runtime.Composable (Row) -> Unit)? = null,
        loading: Boolean = false,
        error: Boolean = false,
        freshness: DataTableFreshness = DataTableFreshness.Live,
        exportable: Boolean = false,
        pageSize: Int? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DataTableContent(
                    columns = columns,
                    rows = rows,
                    keyOf = { it.id },
                    strings = strings,
                    sortState = SortState("name", SortDirection.Asc),
                    selectable = selectable,
                    selectedKeys = emptySet(),
                    onSelectedChange = onSelectedChange,
                    expandable = expandable,
                    expandedKeys = emptySet(),
                    onExpandedChange = onExpandedChange,
                    renderExpanded = renderExpanded,
                    loading = loading,
                    error = error,
                    freshness = freshness,
                    exportable = exportable,
                    pageSize = pageSize,
                )
            }
        }
    }

    /** A [Logger] that records every emitted record, so the test can assert the diagnostics contract (P1/S11). */
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
