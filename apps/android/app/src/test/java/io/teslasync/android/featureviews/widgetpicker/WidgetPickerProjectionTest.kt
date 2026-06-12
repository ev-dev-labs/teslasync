package io.teslasync.android.featureviews.widgetpicker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetPicker's pure logic — the native analogue of every derivation the web
 * component performs (web/src/features/dashboard/components/WidgetPicker.tsx): filtering, grouping,
 * recently-added visibility, add-all de-duplication, recently-added persistence ordering, highlighting, and
 * the searching-vs-grouped-vs-empty body branch. Also pins the ported catalogue/preset parity and the stable
 * surface identifiers. Runs in the :android:testReleaseUnitTest gate.
 */
class WidgetPickerProjectionTest {
    private val catalog =
        listOf(
            PickerWidget("battery-gauge", "Battery Level", "Battery percentage with radial gauge", WidgetCategory.Battery, 1, 2),
            PickerWidget("range-bar", "Range Bar", "Horizontal bar with EPA comparison", WidgetCategory.Battery, 2, 2),
            PickerWidget("charge-status", "Charge Status", "Current charge state, amps", WidgetCategory.Charging, 2, 2),
            PickerWidget("location-map", "Vehicle Location Map", "Live map of vehicle position", WidgetCategory.Maps, 2, 4),
        )

    @Test
    fun normalizeQueryTrimsAndLowercases() {
        assertEquals("battery", WidgetPickerProjection.normalizeQuery("  Battery "))
    }

    @Test
    fun filteredWidgetsByCategoryReturnsThePool() {
        val result = WidgetPickerProjection.filteredWidgets("", WidgetCategory.Battery, catalog)
        assertEquals(listOf("battery-gauge", "range-bar"), result.map { it.id })
    }

    @Test
    fun filteredWidgetsMatchesNameDescriptionOrCategoryToken() {
        assertEquals(listOf("battery-gauge", "range-bar"), WidgetPickerProjection.filteredWidgets("battery", null, catalog).map { it.id })
        assertEquals(listOf("range-bar"), WidgetPickerProjection.filteredWidgets("epa", null, catalog).map { it.id })
        assertEquals(listOf("location-map"), WidgetPickerProjection.filteredWidgets("maps", null, catalog).map { it.id })
    }

    @Test
    fun filteredWidgetsAppliesQueryWithinCategory() {
        assertTrue(WidgetPickerProjection.filteredWidgets("battery", WidgetCategory.Charging, catalog).isEmpty())
    }

    @Test
    fun groupedPreservesRegistryOrderAndCountsAddable() {
        val groups = WidgetPickerProjection.groupedByCategory(null, setOf("battery-gauge"), catalog)
        assertEquals(listOf(WidgetCategory.Battery, WidgetCategory.Charging, WidgetCategory.Maps), groups.map { it.category })
        val battery = groups.first()
        assertEquals(2, battery.widgets.size)
        assertEquals(1, battery.addableCount)
    }

    @Test
    fun availableCategoriesAreDistinctInRegistryOrder() {
        assertEquals(
            listOf(WidgetCategory.Battery, WidgetCategory.Charging, WidgetCategory.Maps),
            WidgetPickerProjection.availableCategories(catalog),
        )
    }

    @Test
    fun recentlyAddedHiddenWhileSearchingOrFiltering() {
        assertTrue(WidgetPickerProjection.recentlyAddedVisible(listOf("range-bar"), emptySet(), "ba", null, catalog).isEmpty())
        assertTrue(
            WidgetPickerProjection.recentlyAddedVisible(listOf("range-bar"), emptySet(), "", WidgetCategory.Battery, catalog).isEmpty(),
        )
    }

    @Test
    fun recentlyAddedDropsUnknownAndActivePreservingOrder() {
        val recent = listOf("range-bar", "unknown", "charge-status", "battery-gauge")
        val result = WidgetPickerProjection.recentlyAddedVisible(recent, setOf("charge-status"), "", null, catalog)
        assertEquals(listOf("range-bar", "battery-gauge"), result.map { it.id })
    }

    @Test
    fun recentlyAddedCapsAtEightOnRealCatalog() {
        val recent = widgetCatalog.take(10).map { it.id }
        assertEquals(
            WidgetPickerProjection.RECENTLY_ADDED_MAX,
            WidgetPickerProjection.recentlyAddedVisible(recent, emptySet(), "", null).size,
        )
    }

    @Test
    fun addableIdsDeDuplicatesAndSkipsActiveAndUnknown() {
        val requested = listOf("battery-gauge", "battery-gauge", "charge-status", "unknown", "range-bar")
        val result = WidgetPickerProjection.addableIds(requested, setOf("charge-status"), catalog)
        assertEquals(listOf("battery-gauge", "range-bar"), result)
    }

    @Test
    fun nextRecentlyAddedPutsAddedFirstDeDupedAndCapped() {
        assertEquals(listOf("c", "a", "b"), WidgetPickerProjection.nextRecentlyAdded(listOf("a", "b"), listOf("c")))
        assertEquals(listOf("a", "b"), WidgetPickerProjection.nextRecentlyAdded(listOf("b", "a"), listOf("a")))
        val current = (1..8).map { "w$it" }
        val capped = WidgetPickerProjection.nextRecentlyAdded(current, listOf("new"))
        assertEquals(WidgetPickerProjection.RECENTLY_ADDED_MAX, capped.size)
        assertEquals("new", capped.first())
        assertFalse(capped.contains("w8"))
    }

    @Test
    fun singleAddableForEnterReturnsTheLoneMatchOnly() {
        assertEquals("location-map", WidgetPickerProjection.singleAddableForEnter("maps", null, emptySet(), catalog)?.id)
        assertNull(WidgetPickerProjection.singleAddableForEnter("battery", null, emptySet(), catalog))
        assertNull(WidgetPickerProjection.singleAddableForEnter("", null, emptySet(), catalog))
        assertNull(WidgetPickerProjection.singleAddableForEnter("maps", null, setOf("location-map"), catalog))
    }

    @Test
    fun sizeLabelFormatsTheGridFootprint() {
        assertEquals("2×4 grid", WidgetPickerProjection.sizeLabel(catalog.last()))
    }

    @Test
    fun highlightSplitsAroundTheCaseInsensitiveMatch() {
        val match = WidgetPickerProjection.highlight("Battery Level", "lev")
        assertEquals("Battery ", match.before)
        assertEquals("Lev", match.match)
        assertEquals("el", match.after)
    }

    @Test
    fun highlightReturnsWholeTextWhenNoMatchOrEmptyQuery() {
        val none = WidgetPickerProjection.highlight("Battery", "xyz")
        assertEquals("Battery", none.before)
        assertEquals("", none.match)
        val empty = WidgetPickerProjection.highlight("Battery", "")
        assertEquals("Battery", empty.before)
        assertEquals("", empty.match)
    }

    @Test
    fun projectRendersTheGroupedBodyWhenNotSearching() {
        val view = WidgetPickerProjection.project(WidgetPickerInput(), catalog, widgetPresets)
        assertFalse(view.isSearching)
        assertTrue(view.showPresets)
        assertEquals(4, view.availableCount)
        assertTrue(view.body is WidgetPickerBody.Grouped)
    }

    @Test
    fun projectRendersResultsWithAddAllWhenSearchingMultiple() {
        val view = WidgetPickerProjection.project(WidgetPickerInput(search = "battery"), catalog)
        assertTrue(view.isSearching)
        assertFalse(view.showPresets)
        val body = view.body as WidgetPickerBody.Results
        assertEquals(2, body.widgets.size)
        assertTrue(body.showAddAll)
        assertEquals(2, body.addableCount)
    }

    @Test
    fun projectHidesAddAllForASingleResult() {
        val body = WidgetPickerProjection.project(WidgetPickerInput(search = "maps"), catalog).body as WidgetPickerBody.Results
        assertEquals(1, body.widgets.size)
        assertFalse(body.showAddAll)
    }

    @Test
    fun projectRendersEmptyWhenNoMatch() {
        val view = WidgetPickerProjection.project(WidgetPickerInput(search = "zzz"), catalog)
        assertTrue(view.body is WidgetPickerBody.Empty)
        assertEquals("zzz", view.rawQuery)
    }

    @Test
    fun projectHidesPresetsWhenFilteringByCategory() {
        val view = WidgetPickerProjection.project(WidgetPickerInput(categoryFilter = WidgetCategory.Battery), catalog)
        assertFalse(view.showPresets)
    }

    @Test
    fun projectCountsAddedThisSession() {
        val view = WidgetPickerProjection.project(WidgetPickerInput(addedThisSessionIds = setOf("a", "b")), catalog)
        assertEquals(2, view.addedThisSessionCount)
    }

    @Test
    fun catalogPortsEveryRegistryWidgetWithUniqueIds() {
        assertEquals(118, widgetCatalog.size)
        assertEquals(widgetCatalog.size, widgetCatalog.map { it.id }.distinct().size)
        assertEquals(16, widgetCatalog.map { it.category }.distinct().size)
    }

    @Test
    fun realCatalogCategoriesFollowTheDeclaredRegistryOrder() {
        assertEquals(WidgetCategory.entries.toList(), WidgetPickerProjection.availableCategories())
    }

    @Test
    fun presetsPortedAndReferenceOnlyKnownWidgets() {
        assertEquals(10, widgetPresets.size)
        val known = widgetCatalog.map { it.id }.toSet()
        widgetPresets.forEach { preset ->
            preset.widgetIds.forEach { id ->
                assertTrue("preset ${preset.id} references unknown widget $id", id in known)
            }
        }
        assertEquals(8, widgetPresets.first { it.id == "default" }.widgetCount)
    }

    @Test
    fun inMemoryRecentStoreRoundTrips() {
        val store = InMemoryWidgetPickerRecentStore(listOf("a"))
        assertEquals(listOf("a"), store.load())
        store.save(listOf("b", "c"))
        assertEquals(listOf("b", "c"), store.load())
    }

    @Test
    fun registrationExposesStableIdsSlugAndTestTags() {
        assertEquals("widget-picker", WidgetPickerRegistration.ID)
        assertEquals("WidgetPicker", WidgetPickerRegistration.SLUG)
        assertEquals("dashboard-widget-picker", WidgetPickerRegistration.SHEET_TEST_TAG)
        assertEquals("dashboard-widget-picker-search", WidgetPickerRegistration.SEARCH_TEST_TAG)
        assertEquals("dashboard-widget-picker-card-", WidgetPickerRegistration.WIDGET_TAG_PREFIX)
    }
}
