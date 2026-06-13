package io.teslasync.android.modalsdialogs.widgetcataloguedialog

import io.teslasync.android.featureviews.widgetpicker.PickerWidget
import io.teslasync.android.featureviews.widgetpicker.WidgetCategory
import io.teslasync.android.featureviews.widgetpicker.widgetCatalog
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetCatalogueDialog's pure logic — the native analogue of every derivation
 * the web component performs (web/src/features/dashboard/components/WidgetCatalogueDialog.tsx): ordered
 * grouping, the name/description/id plus translated-category-label search, the visible-count, and the
 * searching-vs-grouped-vs-empty body branch. Also pins the ported category order/emoji parity, the surface
 * identifiers, the PII-safe `view.opened` diagnostic, and the real registry's parity (118 widgets / 16
 * categories) consumed verbatim from the sibling [widgetCatalog]. Runs in the :android:testReleaseUnitTest gate.
 */
class WidgetCatalogueDialogProjectionTest {
    private val catalog =
        listOf(
            PickerWidget("battery-gauge", "Battery Level", "Battery percentage with radial gauge", WidgetCategory.Battery, 1, 2),
            PickerWidget("range-bar", "Range Bar", "Horizontal bar with EPA comparison", WidgetCategory.Battery, 2, 2),
            PickerWidget("charge-status", "Charge Status", "Current charge state, amps", WidgetCategory.Charging, 2, 2),
            PickerWidget("drive-score", "Drive Score", "Smoothness and efficiency grade", WidgetCategory.Driving, 2, 2),
            PickerWidget("location-map", "Vehicle Location Map", "Live map of vehicle position", WidgetCategory.Maps, 2, 4),
        )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    @Test
    fun normalizeQueryTrimsAndLowercases() {
        assertEquals("battery", WidgetCatalogueProjection.normalizeQuery("  Battery "))
    }

    @Test
    fun orderedGroupsFollowsCatalogueOrderAndDropsEmpty() {
        val groups = WidgetCatalogueProjection.orderedGroups(catalog)
        // Charging precedes Driving — the distinguishing CatalogueDialog order (web CATEGORY_ORDER).
        assertEquals(
            listOf(WidgetCategory.Battery, WidgetCategory.Charging, WidgetCategory.Driving, WidgetCategory.Maps),
            groups.map { it.category },
        )
        assertEquals(2, groups.first { it.category == WidgetCategory.Battery }.widgets.size)
    }

    @Test
    fun orderedGroupsAppendsCategoriesMissingFromTheOrder() {
        val groups = WidgetCatalogueProjection.orderedGroups(catalog, order = listOf(WidgetCategory.Maps))
        // Maps first (the only ordered entry), then every leftover category — nothing is hidden.
        assertEquals(WidgetCategory.Maps, groups.first().category)
        assertEquals(catalog.map { it.category }.distinct().size, groups.map { it.category }.distinct().size)
    }

    @Test
    fun filterGroupsMatchesNameDescriptionOrId() {
        val grouped = WidgetCatalogueProjection.orderedGroups(catalog)
        assertEquals(
            listOf("battery-gauge", "range-bar"),
            WidgetCatalogueProjection.filterGroups(grouped, "battery").flatMap { it.widgets.map { w -> w.id } },
        )
        assertEquals(
            listOf("range-bar"),
            WidgetCatalogueProjection.filterGroups(grouped, "epa").flatMap { it.widgets.map { w -> w.id } },
        )
        assertEquals(
            listOf("charge-status"),
            WidgetCatalogueProjection.filterGroups(grouped, "charge-status").flatMap { it.widgets.map { w -> w.id } },
        )
    }

    @Test
    fun filterGroupsCategoryHitUsesTranslatedLabelAndKeepsAllWidgets() {
        val grouped = WidgetCatalogueProjection.orderedGroups(catalog)
        // The query matches none of the Battery widgets' name/description/id, only the (localized) category label.
        val labels = mapOf(WidgetCategory.Battery to "Akkureichweite")
        val result = WidgetCatalogueProjection.filterGroups(grouped, "akku", labels)
        assertEquals(listOf(WidgetCategory.Battery), result.map { it.category })
        assertEquals(listOf("battery-gauge", "range-bar"), result.single().widgets.map { it.id })
    }

    @Test
    fun filterGroupsFallsBackToEnglishCategoryLabelWhenUnmapped() {
        val grouped = WidgetCatalogueProjection.orderedGroups(catalog)
        // No injected labels — "charging" hits the default English WidgetCategory.label.
        val result = WidgetCatalogueProjection.filterGroups(grouped, "charging")
        assertEquals(listOf(WidgetCategory.Charging), result.map { it.category })
    }

    @Test
    fun projectNotFilteringReturnsAllSections() {
        val view = WidgetCatalogueProjection.project(WidgetCatalogueInput(), catalog)
        assertFalse(view.isFiltering)
        val body = view.body as WidgetCatalogueBody.Sections
        assertEquals(catalog.size, body.groups.sumOf { it.widgets.size })
        assertEquals(catalog.size, view.totalCount)
        assertEquals(catalog.size, view.visibleCount)
    }

    @Test
    fun projectFilteringReturnsMatchingSectionsAndVisibleCount() {
        val view = WidgetCatalogueProjection.project(WidgetCatalogueInput(query = "battery"), catalog)
        assertTrue(view.isFiltering)
        val body = view.body as WidgetCatalogueBody.Sections
        assertEquals(listOf(WidgetCategory.Battery), body.groups.map { it.category })
        assertEquals(2, view.visibleCount)
    }

    @Test
    fun projectFilteringWithNoMatchIsEmpty() {
        val view = WidgetCatalogueProjection.project(WidgetCatalogueInput(query = "zzz"), catalog)
        assertTrue(view.isFiltering)
        assertEquals(WidgetCatalogueBody.Empty, view.body)
        assertEquals(0, view.visibleCount)
    }

    @Test
    fun projectCountsAddedFromActiveWidgetIds() {
        val view =
            WidgetCatalogueProjection.project(
                WidgetCatalogueInput(activeWidgetIds = setOf("battery-gauge", "charge-status")),
                catalog,
            )
        assertEquals(2, view.addedCount)
        assertEquals(catalog.size, view.totalCount)
    }

    @Test
    fun categoryOrderHasSixteenEntriesWithChargingBeforeDriving() {
        assertEquals(16, CATEGORY_ORDER.size)
        assertEquals(16, CATEGORY_ORDER.distinct().size)
        assertTrue(CATEGORY_ORDER.indexOf(WidgetCategory.Charging) < CATEGORY_ORDER.indexOf(WidgetCategory.Driving))
    }

    @Test
    fun categoryEmojiIsExhaustiveDistinctAndNonBlank() {
        val emojis = WidgetCategory.entries.map { categoryEmoji(it) }
        assertEquals(16, emojis.size)
        assertTrue(emojis.all { it.isNotBlank() })
        assertEquals(16, emojis.distinct().size)
    }

    @Test
    fun defaultCategoryLabelsCoverEverySixteenCategories() {
        assertEquals(16, DEFAULT_CATEGORY_LABELS.size)
        assertEquals(WidgetCategory.entries.toSet(), DEFAULT_CATEGORY_LABELS.keys)
    }

    @Test
    fun realCatalogPortsEveryRegistryWidgetAcrossSixteenCategories() {
        val view = WidgetCatalogueProjection.project(WidgetCatalogueInput())
        assertEquals(118, view.totalCount)
        val body = view.body as WidgetCatalogueBody.Sections
        assertEquals(118, body.groups.sumOf { it.widgets.size })
        assertEquals(CATEGORY_ORDER, body.groups.map { it.category })
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceDiagnostic() {
        val logger = RecordingLogger()
        WidgetCatalogueDialogDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "WidgetCatalogueDialog"), fields)
    }

    @Test
    fun registrationExposesStableIdsSlugAndTestTags() {
        assertEquals("widget-catalogue-dialog", WidgetCatalogueDialogRegistration.ID)
        assertEquals("WidgetCatalogueDialog", WidgetCatalogueDialogRegistration.SLUG)
        assertEquals("widget-catalogue-search", WidgetCatalogueDialogRegistration.SEARCH_TEST_TAG)
        assertEquals("widget-catalogue-result-count", WidgetCatalogueDialogRegistration.RESULT_COUNT_TEST_TAG)
        assertEquals("widget-catalogue-empty", WidgetCatalogueDialogRegistration.EMPTY_TEST_TAG)
        assertEquals("widget-catalogue-clear-search", WidgetCatalogueDialogRegistration.CLEAR_SEARCH_TEST_TAG)
        assertEquals("widget-catalogue-category-", WidgetCatalogueDialogRegistration.CATEGORY_TAG_PREFIX)
        assertEquals("widget-catalogue-entry-", WidgetCatalogueDialogRegistration.ENTRY_TAG_PREFIX)
    }
}
