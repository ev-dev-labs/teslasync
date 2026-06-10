package io.teslasync.android.components.forms

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.UiDensity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free forms logic (combobox filtering, multi-select toggling,
 * tag parsing, chip overflow, date presets, numeric/currency parsing, range normalization, vehicle
 * selection hydration/payload, tree-select selection, search debounce/history, sort + density
 * toggles, export formats). These run in the `:android:testDebugUnitTest` gate and cover the
 * behavior the composables only render.
 */
class FormsLogicTest {
    private val options =
        listOf(
            ComboOption("m3", "Model 3"),
            ComboOption("my", "Model Y"),
            ComboOption("ms", "Model S"),
        )

    // ── Combobox ───────────────────────────────────────────────────────────────────
    @Test
    fun filterComboOptionsIsCaseInsensitiveAndBlankReturnsAll() {
        assertEquals(3, filterComboOptions(options, "  ").size)
        assertEquals(listOf("m3", "my", "ms"), filterComboOptions(options, "model").map { it.value })
        assertEquals(listOf("m3"), filterComboOptions(options, "3").map { it.value })
        assertEquals(listOf("ms"), filterComboOptions(options, "model s").map { it.value })
    }

    @Test
    fun comboLabelForResolvesSelection() {
        assertEquals("Model Y", comboLabelFor(options, "my"))
        assertNull(comboLabelFor(options, "zz"))
        assertNull(comboLabelFor(options, null))
    }

    @Test
    fun toggleSelectionAddsAndRemoves() {
        assertEquals(setOf("a"), toggleSelection(emptySet(), "a"))
        assertEquals(emptySet<String>(), toggleSelection(setOf("a"), "a"))
        assertEquals(setOf("a", "b"), toggleSelection(setOf("a"), "b"))
    }

    // ── Tag input ────────────────────────────────────────────────────────────────
    @Test
    fun parseTagsTrimsSplitsAndDropsBlanks() {
        assertEquals(listOf("a", "b", "c", "d"), parseTags("a, b ,, c\n d"))
        assertEquals(emptyList<String>(), parseTags("  , \n "))
    }

    @Test
    fun addTagsDeduplicatesUnlessAllowed() {
        assertEquals(listOf("home", "work"), addTags(listOf("home"), "work"))
        assertEquals(listOf("home"), addTags(listOf("home"), "home"))
        assertEquals(listOf("home", "home"), addTags(listOf("home"), "home", allowDuplicates = true))
        assertEquals(listOf("a", "b", "c"), addTags(listOf("a"), "b,c"))
    }

    @Test
    fun removeTagHelpers() {
        assertEquals(listOf("a", "c"), removeTagAt(listOf("a", "b", "c"), 1))
        assertEquals(listOf("a", "b"), removeTagAt(listOf("a", "b"), 9))
        assertEquals(listOf("a"), removeLastTag(listOf("a", "b")))
        assertEquals(emptyList<String>(), removeLastTag(emptyList()))
    }

    // ── Chip overflow ───────────────────────────────────────────────────────────────
    @Test
    fun chipSplitReservesSlotForOverflowTrigger() {
        assertEquals(ChipSplit(5, 0), chipSplit(5, 8))
        assertEquals(ChipSplit(7, 3), chipSplit(10, 8))
        assertEquals(ChipSplit(0, 3), chipSplit(3, 0))
        assertEquals(ChipSplit(8, 0), chipSplit(8, 8))
    }

    // ── Date presets ─────────────────────────────────────────────────────────────
    @Test
    fun resolveDatePresetComputesInclusiveWindows() {
        val today = 100L
        assertEquals(DateRange(100, 100), resolveDatePreset(DatePreset.Today, today))
        assertEquals(DateRange(94, 100), resolveDatePreset(DatePreset.Last7Days, today))
        assertEquals(DateRange(71, 100), resolveDatePreset(DatePreset.Last30Days, today))
        assertEquals(DateRange(11, 100), resolveDatePreset(DatePreset.Last90Days, today))
        assertEquals(DateRange(100 - 364, 100), resolveDatePreset(DatePreset.LastYear, today))
    }

    @Test
    fun datePresetLabelsAreHumanReadable() {
        assertEquals("Today", datePresetLabel(DatePreset.Today))
        assertEquals("Last 7 days", datePresetLabel(DatePreset.Last7Days))
        assertEquals("Last year", datePresetLabel(DatePreset.LastYear))
    }

    // ── Numeric range ──────────────────────────────────────────────────────────────
    @Test
    fun normalizeNumericRangeSwapsInverted() {
        assertEquals(NumericRange(3.0, 5.0), normalizeNumericRange(5.0, 3.0))
        assertEquals(NumericRange(3.0, 5.0), normalizeNumericRange(3.0, 5.0))
        assertEquals(NumericRange(null, 3.0), normalizeNumericRange(null, 3.0))
    }

    @Test
    fun isNumericRangeValidGuards() {
        assertTrue(isNumericRangeValid(3.0, 5.0))
        assertFalse(isNumericRangeValid(5.0, 3.0))
        assertTrue(isNumericRangeValid(null, 3.0))
        assertTrue(isNumericRangeValid(3.0, null))
    }

    // ── Numeric + currency parsing ───────────────────────────────────────────────
    @Test
    fun parseNumericToleratesUnitsAndGrouping() {
        assertEquals(60.0, parseNumeric("60 mph")!!, 1e-9)
        assertEquals(1.5, parseNumeric("$1.50")!!, 1e-9)
        assertEquals(1234.56, parseNumeric("1,234.56")!!, 1e-9)
        assertEquals(20.0, parseNumeric("20\u00b0F")!!, 1e-9)
        assertNull(parseNumeric("abc"))
    }

    @Test
    fun parseCurrencyHandlesAccountingParentheses() {
        assertEquals(-1.5, parseCurrency("($1.50)")!!, 1e-9)
        assertEquals(2.0, parseCurrency("$2.00")!!, 1e-9)
        assertNull(parseCurrency("--"))
    }

    @Test
    fun formatNumericFixedDecimals() {
        assertEquals("1.50", formatNumeric(1.5, 2))
        assertEquals("", formatNumeric(null, 2))
        assertEquals("3", formatNumeric(3.0, 0))
    }

    // ── Vehicle selection ──────────────────────────────────────────────────────────
    @Test
    fun hydrateVehicleSelectionHandlesNullAllAndStale() {
        val all = listOf(1L, 2L, 3L)
        assertEquals(VehicleSelection(setOf(1L, 2L, 3L), true), hydrateVehicleSelection(all, null))
        assertEquals(VehicleSelection(setOf(1L, 2L), false), hydrateVehicleSelection(all, listOf(1L, 2L)))
        assertEquals(VehicleSelection(setOf(1L), false), hydrateVehicleSelection(all, listOf(1L, 9L)))
    }

    @Test
    fun buildVehiclePayloadCollapsesAllToNull() {
        val all = listOf(1L, 2L, 3L)
        assertNull(buildVehiclePayload(VehicleSelection(setOf(1L, 2L, 3L), true), all))
        assertNull(buildVehiclePayload(VehicleSelection(setOf(1L, 2L, 3L), false), all))
        assertEquals(listOf(1L), buildVehiclePayload(VehicleSelection(setOf(1L), false), all))
    }

    @Test
    fun toggleVehicleRecomputesAllSelected() {
        val all = listOf(1L, 2L, 3L)
        val one = VehicleSelection(setOf(1L), false)
        assertEquals(VehicleSelection(setOf(1L, 2L), false), toggleVehicle(one, 2L, all))
        val two = VehicleSelection(setOf(1L, 2L), false)
        assertTrue(toggleVehicle(two, 3L, all).allSelected)
    }

    // ── Tree select ──────────────────────────────────────────────────────────────
    @Test
    fun treeSelectionAndExpansion() {
        val group = TreeGroup("d", "Drive", listOf(TreeLeaf("s", "Speed"), TreeLeaf("h", "Heading")))
        assertEquals(setOf("g"), toggleExpanded(emptySet(), "g"))
        assertEquals(emptySet<String>(), toggleExpanded(setOf("g"), "g"))
        assertEquals(setOf("s", "h"), groupLeafValues(group))
        assertTrue(isGroupFullySelected(group, setOf("s", "h")))
        assertFalse(isGroupFullySelected(group, setOf("s")))
        assertTrue(isGroupPartiallySelected(group, setOf("s")))
        assertFalse(isGroupPartiallySelected(group, setOf("s", "h")))
        assertEquals(setOf("s", "h"), toggleGroupSelection(emptySet(), group))
        assertEquals(emptySet<String>(), toggleGroupSelection(setOf("s", "h"), group))
    }

    // ── Search ─────────────────────────────────────────────────────────────────────
    @Test
    fun searchDebounceHistoryAndIndexing() {
        assertTrue(shouldEmitSearch("ab", "a"))
        assertFalse(shouldEmitSearch("a", "a"))
        assertTrue(meetsMinQuery("ab"))
        assertFalse(meetsMinQuery(" a "))
        assertTrue(searchHistoryVisible(hasScope = true, focused = true, query = "", entryCount = 3))
        assertFalse(searchHistoryVisible(hasScope = true, focused = true, query = "x", entryCount = 3))
        assertFalse(searchHistoryVisible(hasScope = true, focused = false, query = "", entryCount = 3))
        assertFalse(searchHistoryVisible(hasScope = true, focused = true, query = "", entryCount = 0))
        assertEquals(2, clampActiveIndex(5, 3))
        assertEquals(-1, clampActiveIndex(-5, 3))
        assertEquals(-1, clampActiveIndex(0, 0))
        assertEquals(0, nextActiveIndex(-1, 3))
        assertEquals(-1, prevActiveIndex(0, 3))
    }

    // ── Sort + density + export ──────────────────────────────────────────────────
    @Test
    fun flipSortDirectionToggles() {
        assertEquals(SortDirection.Desc, flipSortDirection(SortDirection.Asc))
        assertEquals(SortDirection.Asc, flipSortDirection(SortDirection.Desc))
    }

    @Test
    fun densityCyclesAndLabels() {
        assertEquals(UiDensity.Comfortable, nextDensity(UiDensity.Compact))
        assertEquals(UiDensity.Spacious, nextDensity(UiDensity.Comfortable))
        assertEquals(UiDensity.Compact, nextDensity(UiDensity.Spacious))
        assertEquals("Compact", densityLabel(UiDensity.Compact))
    }

    @Test
    fun exportFormatLabelsAndExtensions() {
        assertEquals("CSV", exportFormatLabel(ExportFormat.Csv))
        assertEquals("Excel", exportFormatLabel(ExportFormat.Xlsx))
        assertEquals("json", exportFileExtension(ExportFormat.Json))
        assertEquals("pdf", exportFileExtension(ExportFormat.Pdf))
    }
}
