// Off-device unit tests for the pure DataTableColumnMenu model: the layout algebra ported from the web
// `columnOrderStore` (effectiveColumnOrder / applyColumnLayout / moveColumn / toggleHiddenColumn /
// defaultColumnLayout), the controlled mutation guards (the web `handleToggle` last-visible refusal + the
// `handleMove` end-of-list refusal), the "cached layout → projection" adapter (`projectColumnMenu`, covering the
// checked / required / last-visible / first / last per-row branches), the empty vs content classifier, the
// trigger/heading key selection, the i18n key inventory (every web `t(key)` this surface makes), the diagnostics
// slug, and the PII-safe `view.opened` diagnostic. Run by the offline :android:testReleaseUnitTest gate — no
// Compose, no Android.

package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DataTableColumnMenuModelTest {
    private fun cols(vararg keys: String): List<ColumnDescriptor> = keys.map { ColumnDescriptor(key = it, header = it.uppercase()) }

    // ── effectiveColumnOrder (web effectiveColumnOrder) ─────────────────────────────────────────────────────────
    @Test
    fun effectiveOrderIsSourceOrderWithoutALayout() {
        assertEquals(listOf("a", "b", "c"), effectiveColumnOrder(cols("a", "b", "c"), null))
    }

    @Test
    fun effectiveOrderLeadsWithTheLayoutThenAppendsTheRemainder() {
        val layout = ColumnLayout(order = listOf("c", "a"), hidden = emptyList())
        assertEquals(listOf("c", "a", "b"), effectiveColumnOrder(cols("a", "b", "c"), layout))
    }

    @Test
    fun effectiveOrderDropsUnknownKeysAndDeduplicates() {
        val layout = ColumnLayout(order = listOf("z", "a", "a", "b"), hidden = emptyList())
        assertEquals(listOf("a", "b", "c"), effectiveColumnOrder(cols("a", "b", "c"), layout))
    }

    // ── applyColumnLayout (web applyColumnLayout) ───────────────────────────────────────────────────────────────
    @Test
    fun applyLayoutHonoursDefaultVisibleWithoutALayout() {
        val columns =
            listOf(
                ColumnDescriptor("a", "A"),
                ColumnDescriptor("b", "B", defaultVisible = false),
            )
        assertEquals(listOf("a"), applyColumnLayout(columns, null).map { it.key })
    }

    @Test
    fun applyLayoutDropsHiddenKeysAndKeepsLayoutOrder() {
        val layout = ColumnLayout(order = listOf("c", "a", "b"), hidden = listOf("b"))
        assertEquals(listOf("c", "a"), applyColumnLayout(cols("a", "b", "c"), layout).map { it.key })
    }

    @Test
    fun applyLayoutFallsBackToDefaultVisibleWhenEverythingIsHidden() {
        val layout = ColumnLayout(order = listOf("a", "b"), hidden = listOf("a", "b"))
        assertEquals(listOf("a", "b"), applyColumnLayout(cols("a", "b"), layout).map { it.key })
    }

    // ── moveColumn (web moveColumn) ─────────────────────────────────────────────────────────────────────────────
    @Test
    fun moveColumnRepositionsAndClamps() {
        assertEquals(listOf("b", "a", "c"), moveColumn(listOf("a", "b", "c"), "a", 1))
        assertEquals(listOf("c", "a", "b"), moveColumn(listOf("a", "b", "c"), "c", 0))
        assertEquals(listOf("b", "c", "a"), moveColumn(listOf("a", "b", "c"), "a", 99))
    }

    @Test
    fun moveColumnReturnsAnUnchangedCopyForAMissingKey() {
        assertEquals(listOf("a", "b", "c"), moveColumn(listOf("a", "b", "c"), "z", 0))
    }

    // ── toggleHiddenColumn (web toggleHiddenColumn) ─────────────────────────────────────────────────────────────
    @Test
    fun toggleHiddenAddsThenRemovesPreservingOrder() {
        val hidden = toggleHiddenColumn(ColumnLayout(listOf("a", "b"), emptyList()), "a")
        assertEquals(listOf("a"), hidden.hidden)
        assertEquals(listOf("a", "b"), hidden.order)

        val shown = toggleHiddenColumn(hidden, "a")
        assertEquals(emptyList<String>(), shown.hidden)
    }

    // ── defaultColumnLayout (web defaultColumnLayout) ───────────────────────────────────────────────────────────
    @Test
    fun defaultLayoutSeedsOrderAndHidesDefaultInvisible() {
        val layout = defaultColumnLayout(sampleColumns())
        assertEquals(listOf("select", "name", "vin", "battery"), layout.order)
        assertEquals(listOf("battery"), layout.hidden)
    }

    // ── toggleColumnLayout (web handleToggle guard) ─────────────────────────────────────────────────────────────
    @Test
    fun toggleRefusesToHideTheLastVisibleColumn() {
        val layout = ColumnLayout(order = listOf("a", "b"), hidden = listOf("b"))
        assertNull(toggleColumnLayout(cols("a", "b"), layout, "a"))
    }

    @Test
    fun toggleAlwaysAllowsReShowingAHiddenColumn() {
        val layout = ColumnLayout(order = listOf("a", "b"), hidden = listOf("b"))
        val next = toggleColumnLayout(cols("a", "b"), layout, "b")
        assertEquals(emptyList<String>(), next?.hidden)
    }

    @Test
    fun toggleHidesWhenMoreThanOneRemainsVisible() {
        val next = toggleColumnLayout(cols("a", "b", "c"), null, "a")
        assertEquals(listOf("a"), next?.hidden)
    }

    // ── moveColumnInLayout (web handleMove guard) ───────────────────────────────────────────────────────────────
    @Test
    fun moveInLayoutRefusesPastEitherEndOrForUnknownKeys() {
        assertNull(moveColumnInLayout(cols("a", "b", "c"), null, "a", MoveDirection.Up))
        assertNull(moveColumnInLayout(cols("a", "b", "c"), null, "c", MoveDirection.Down))
        assertNull(moveColumnInLayout(cols("a", "b", "c"), null, "z", MoveDirection.Down))
    }

    @Test
    fun moveInLayoutShiftsAndCarriesTheHiddenSet() {
        val layout = ColumnLayout(order = listOf("a", "b", "c"), hidden = listOf("c"))
        val next = moveColumnInLayout(cols("a", "b", "c"), layout, "a", MoveDirection.Down)
        assertEquals(listOf("b", "a", "c"), next?.order)
        assertEquals(listOf("c"), next?.hidden)
    }

    // ── projectColumnMenu (the cached → projection adapter) ─────────────────────────────────────────────────────
    @Test
    fun projectionRendersEveryColumnInEffectiveOrder() {
        val model = projectColumnMenu(sampleColumns(), null)
        assertEquals(listOf("select", "name", "vin", "battery"), model.rows.map { it.key })
        assertEquals(3, model.visibleCount)
    }

    @Test
    fun projectionFallsHeaderBackToTheKeyWhenBlank() {
        val select = projectColumnMenu(sampleColumns(), null).rows.first { it.key == "select" }
        assertEquals("select", select.header)
    }

    @Test
    fun projectionReflectsVisibilityFromTheHiddenSet() {
        val rows = projectColumnMenu(sampleColumns(), null).rows.associateBy { it.key }
        assertTrue(rows.getValue("name").checked)
        assertFalse("battery is defaultVisible=false, so hidden by the seeded layout", rows.getValue("battery").checked)
    }

    @Test
    fun projectionDisablesTheCheckboxForRequiredColumns() {
        val select = projectColumnMenu(sampleColumns(), null).rows.first { it.key == "select" }
        assertFalse(select.toggleEnabled)
    }

    @Test
    fun projectionDisablesTheCheckboxForTheLastVisibleColumn() {
        // Only "a" is visible; its checkbox must lock so the table never empties (web checkboxDisabled).
        val layout = ColumnLayout(order = listOf("a", "b"), hidden = listOf("b"))
        val rows = projectColumnMenu(cols("a", "b"), layout).rows.associateBy { it.key }
        assertFalse(rows.getValue("a").toggleEnabled)
        assertTrue("a hidden column's checkbox stays enabled so it can be re-shown", rows.getValue("b").toggleEnabled)
    }

    @Test
    fun projectionDisablesTheArrowsAtTheEnds() {
        val rows = projectColumnMenu(sampleColumns(), null).rows
        assertFalse("the first row cannot move up", rows.first().canMoveUp)
        assertTrue(rows.first().canMoveDown)
        assertFalse("the last row cannot move down", rows.last().canMoveDown)
        assertTrue(rows.last().canMoveUp)
    }

    // ── surface classifier (empty vs content) ───────────────────────────────────────────────────────────────────
    @Test
    fun surfaceIsEmptyOnlyWithZeroColumns() {
        assertEquals(ColumnMenuSurface.Empty, columnMenuSurface(0))
        assertEquals(ColumnMenuSurface.Content, columnMenuSurface(4))
    }

    @Test
    fun emptyColumnsProjectToNoRows() {
        val model = projectColumnMenu(emptyList(), null)
        assertEquals(emptyList<ColumnMenuRow>(), model.rows)
        assertEquals(0, model.visibleCount)
    }

    // ── trigger / heading key selection (web ternaries) ─────────────────────────────────────────────────────────
    @Test
    fun triggerAndHeadingKeysFollowTheReorderableMode() {
        assertEquals(DataTableColumnMenuKeys.MENU_REORDER, triggerLabelKey(reorderable = true))
        assertEquals(DataTableColumnMenuKeys.MENU, triggerLabelKey(reorderable = false))
        assertEquals(DataTableColumnMenuKeys.HEADING_REORDER, headingKey(reorderable = true))
        assertEquals(DataTableColumnMenuKeys.HEADING, headingKey(reorderable = false))
    }

    // ── i18n inventory (every web t(key) this surface makes) ────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndPrefixed() {
        assertEquals(9, DataTableColumnMenuKeys.ALL.size)
        assertEquals(DataTableColumnMenuKeys.ALL.size, DataTableColumnMenuKeys.ALL.toSet().size)
        assertTrue(DataTableColumnMenuKeys.ALL.all { it.startsWith("table.columns.") })
        assertTrue(
            DataTableColumnMenuKeys.ALL.containsAll(
                listOf(
                    DataTableColumnMenuKeys.MENU_REORDER,
                    DataTableColumnMenuKeys.MENU,
                    DataTableColumnMenuKeys.BUTTON,
                    DataTableColumnMenuKeys.HEADING_REORDER,
                    DataTableColumnMenuKeys.HEADING,
                    DataTableColumnMenuKeys.RESET,
                    DataTableColumnMenuKeys.TOGGLE_COLUMN,
                    DataTableColumnMenuKeys.MOVE_UP,
                    DataTableColumnMenuKeys.MOVE_DOWN,
                ),
            ),
        )
    }

    // ── telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPii() {
        assertEquals("DataTableColumnMenu", DataTableColumnMenuRegistration.SLUG)
        assertEquals("view.opened", EVENT_VIEW_OPENED)
        assertEquals("surface", FIELD_SURFACE)
    }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        recordDataTableColumnMenuOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "DataTableColumnMenu"), opened.second)
    }
}
