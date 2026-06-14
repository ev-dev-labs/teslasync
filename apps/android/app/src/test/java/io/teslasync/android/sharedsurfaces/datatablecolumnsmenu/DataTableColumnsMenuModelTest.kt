// Off-device unit tests for the pure DataTableColumnsMenu model: the toggle transition (web `toggle` — remove a
// visible column, keep the last one, re-add a hidden column preserving column order), the show-all reset, the
// props → display projection across the content / required / last-visible / empty cases, the header||key row-label
// fallback, the i18n key inventory (every web `t(key)` this surface makes), the diagnostics slug, and the PII-safe
// `view.opened` diagnostic. Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android.

package io.teslasync.android.sharedsurfaces.datatablecolumnsmenu

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DataTableColumnsMenuModelTest {
    private val columns =
        listOf(
            ColumnDescriptor(key = "select", header = "Select", required = true),
            ColumnDescriptor(key = "date", header = "Date"),
            ColumnDescriptor(key = "distance", header = "Distance"),
            ColumnDescriptor(key = "energy", header = "Energy"),
        )

    // ── toggle: remove a visible column (web onChange(visibleKeys.filter(k => k !== key))) ──────────────────────
    @Test
    fun toggleRemovesAVisibleColumn() {
        val next = DataTableColumnsMenuProjection.toggle(columns, listOf("date", "distance"), "date")
        assertEquals(listOf("distance"), next)
    }

    // ── toggle: never hide the last visible column (web `if (visibleKeys.length <= 1) return`) ──────────────────
    @Test
    fun toggleKeepsTheLastVisibleColumn() {
        val next = DataTableColumnsMenuProjection.toggle(columns, listOf("date"), "date")
        assertEquals(listOf("date"), next)
    }

    // ── toggle: re-add a hidden column PRESERVING the original column order (web order.filter(...)) ─────────────
    @Test
    fun toggleReAddsHiddenColumnInColumnOrder() {
        // Adding "date" (column index 1) to a visible set of {distance} (index 2) must place date BEFORE distance.
        val next = DataTableColumnsMenuProjection.toggle(columns, listOf("distance"), "date")
        assertEquals(listOf("date", "distance"), next)
    }

    @Test
    fun toggleAddingARequiredColumnStillFollowsColumnOrder() {
        val next = DataTableColumnsMenuProjection.toggle(columns, listOf("energy"), "select")
        assertEquals(listOf("select", "energy"), next)
    }

    // ── showAll: every column key, in column order (web columns.map(c => c.key)) ─────────────────────────────────
    @Test
    fun showAllReturnsEveryKeyInColumnOrder() {
        assertEquals(listOf("select", "date", "distance", "energy"), DataTableColumnsMenuProjection.showAll(columns))
    }

    // ── projection: content — checked reflects visibility, order matches columns ────────────────────────────────
    @Test
    fun projectMarksCheckedColumnsAndKeepsColumnOrder() {
        val display = DataTableColumnsMenuProjection.project(columns, listOf("date", "energy"))

        assertEquals(listOf("select", "date", "distance", "energy"), display.rows.map { it.key })
        assertEquals(
            mapOf("select" to false, "date" to true, "distance" to false, "energy" to true),
            display.rows.associate { it.key to it.checked },
        )
        assertTrue(display.hasColumns)
        assertTrue(display.canShowAll)
        assertFalse(display.isEmpty)
    }

    // ── projection: required columns are always disabled (web col.required) ─────────────────────────────────────
    @Test
    fun projectDisablesRequiredColumns() {
        val select = DataTableColumnsMenuProjection.project(columns, listOf("select", "date")).rows.single { it.key == "select" }
        assertTrue(select.disabled)
        assertTrue(select.checked)
    }

    // ── projection: the checked last-visible column is disabled, others stay enabled ───────────────────────────
    @Test
    fun projectDisablesTheCheckedLastVisibleColumn() {
        val display = DataTableColumnsMenuProjection.project(columns, listOf("date"))
        val date = display.rows.single { it.key == "date" }
        val distance = display.rows.single { it.key == "distance" }

        assertTrue(date.checked)
        assertTrue(date.disabled)
        assertFalse(distance.checked)
        assertFalse(distance.disabled)
    }

    @Test
    fun projectEnablesUncheckedColumnsWhenMoreThanOneVisible() {
        val display = DataTableColumnsMenuProjection.project(columns, listOf("date", "distance"))
        val date = display.rows.single { it.key == "date" }
        assertTrue(date.checked)
        // With two visible, hiding one is allowed again, so the checked non-required rows are enabled.
        assertFalse(date.disabled)
    }

    // ── projection: empty — no columns, the menu still renders its header (never a blank box) ───────────────────
    @Test
    fun projectClassifiesEmptyWhenThereAreNoColumns() {
        val display = DataTableColumnsMenuProjection.project(emptyList(), emptyList())
        assertTrue(display.rows.isEmpty())
        assertFalse(display.hasColumns)
        assertFalse(display.canShowAll)
        assertTrue(display.isEmpty)
    }

    // ── row label: web `col.header || col.key` (blank header falls back to the key) ─────────────────────────────
    @Test
    fun rowLabelFallsBackToKeyWhenHeaderBlank() {
        assertEquals("date", DataTableColumnsMenuProjection.rowLabel(ColumnDescriptor(key = "date", header = "")))
        assertEquals("Distance", DataTableColumnsMenuProjection.rowLabel(ColumnDescriptor(key = "distance", header = "Distance")))
        val display = DataTableColumnsMenuProjection.project(listOf(ColumnDescriptor(key = "raw", header = "")), listOf("raw"))
        assertEquals("raw", display.rows.single().label)
    }

    // ── i18n inventory (every web t(key) this surface makes) ────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndPrefixed() {
        assertEquals(4, DataTableColumnsMenuKeys.ALL.size)
        assertEquals(DataTableColumnsMenuKeys.ALL.size, DataTableColumnsMenuKeys.ALL.toSet().size)
        assertTrue(DataTableColumnsMenuKeys.ALL.all { it.startsWith("table.columns.") })
        assertTrue(
            DataTableColumnsMenuKeys.ALL.containsAll(
                listOf(
                    DataTableColumnsMenuKeys.MENU,
                    DataTableColumnsMenuKeys.BUTTON,
                    DataTableColumnsMenuKeys.HEADING,
                    DataTableColumnsMenuKeys.SHOW_ALL,
                ),
            ),
        )
    }

    // ── telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPii() {
        assertEquals("DataTableColumnsMenu", DataTableColumnsMenuRegistration.SLUG)
        assertEquals("DataTableColumnsMenu", DataTableColumnsMenuDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        DataTableColumnsMenuDiagnostics.recordViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "DataTableColumnsMenu"), opened.second)
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
