package io.teslasync.android.modalsdialogs.widgetcataloguedialog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.featureviews.widgetpicker.PickerWidget
import io.teslasync.android.featureviews.widgetpicker.WidgetCategory
import io.teslasync.android.featureviews.widgetpicker.widgetCatalog
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of the WidgetCatalogueDialog across the render branches
 * the web component defines (web/src/features/dashboard/components/WidgetCatalogueDialog.tsx): the grouped
 * catalogue, the searching subset (non-matches hidden) with its live result count, the empty "no widgets match"
 * panel with Clear-search, and the per-widget already-added state (badge + disabled Add). The full dialog path
 * also asserts the labeled close affordance and the add-then-close wiring. Accessibility is checked via the
 * search field's content description and each Add action's "Add {name} widget" label. All visible copy resolves
 * from the app's i18n resources so the test follows the device locale rather than hard-coding English. Runs under
 * connectedAndroidTest; the offline testReleaseUnitTest gate covers the pure projection.
 */
class WidgetCatalogueDialogUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private val catalog =
        listOf(
            PickerWidget("battery-gauge", "Battery Level", "Battery percentage with radial gauge", WidgetCategory.Battery, 1, 2),
            PickerWidget("charge-status", "Charge Status", "Current charge state, amps", WidgetCategory.Charging, 2, 2),
            PickerWidget("location-map", "Vehicle Location Map", "Live map of vehicle position", WidgetCategory.Maps, 2, 4),
        )

    private fun renderContent(
        query: String,
        activeWidgetIds: Set<String> = emptySet(),
        onAddWidget: (PickerWidget) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.fillMaxSize()) {
                    WidgetCatalogueDialogContent(
                        query = query,
                        view = WidgetCatalogueProjection.project(WidgetCatalogueInput(query, activeWidgetIds), catalog),
                        activeWidgetIds = activeWidgetIds,
                        categoryLabels = DEFAULT_CATEGORY_LABELS,
                        onQueryChange = {},
                        onClearSearch = {},
                        onAddWidget = onAddWidget,
                    )
                }
            }
        }
    }

    @Test
    fun groupedStateShowsSubtitleSearchFieldAndCategoryWidgets() {
        renderContent(query = "")

        compose.onNodeWithTag(WidgetCatalogueDialogRegistration.DIALOG_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithTag(WidgetCatalogueDialogRegistration.SEARCH_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Battery Level").assertIsDisplayed()
        compose.onNodeWithText("Charge Status").assertIsDisplayed()
        compose
            .onNodeWithText(context.getString(R.string.translation_dashboard_catalogue_category_battery))
            .assertIsDisplayed()
    }

    @Test
    fun searchingStateShowsMatchHidesNonMatchesAndShowsResultCount() {
        renderContent(query = "battery")

        compose.onNodeWithText("Battery Level").assertIsDisplayed()
        compose.onAllNodesWithText("Charge Status").assertCountEquals(0)
        compose.onNodeWithTag(WidgetCatalogueDialogRegistration.RESULT_COUNT_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsMessageAndClearSearch() {
        renderContent(query = "zzz")

        compose.onNodeWithTag(WidgetCatalogueDialogRegistration.EMPTY_TEST_TAG).assertIsDisplayed()
        compose
            .onNodeWithText(context.getString(R.string.translation_dashboard_catalogue_emptyTitle))
            .assertIsDisplayed()
        compose.onNodeWithTag(WidgetCatalogueDialogRegistration.CLEAR_SEARCH_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun addedWidgetShowsBadgeAndDisablesAddAction() {
        renderContent(query = "battery", activeWidgetIds = setOf("battery-gauge"))

        val addedNodes = compose.onAllNodesWithText(context.getString(R.string.translation_dashboard_added))
        assertTrue(addedNodes.fetchSemanticsNodes().isNotEmpty())

        val addLabel = context.getString(R.string.translation_dashboard_catalogue_addLabel, "Battery Level")
        compose.onNodeWithContentDescription(addLabel).assertIsNotEnabled()
    }

    @Test
    fun tappingAddActionInvokesOnAddWidget() {
        val added = mutableListOf<String>()
        renderContent(query = "charge", onAddWidget = { added += it.id })

        val addLabel = context.getString(R.string.translation_dashboard_catalogue_addLabel, "Charge Status")
        compose.onNodeWithContentDescription(addLabel).performClick()

        assertEquals(listOf("charge-status"), added)
    }

    @Test
    fun searchFieldExposesAccessibilityLabel() {
        renderContent(query = "")

        val searchLabel = context.getString(R.string.translation_dashboard_catalogue_searchLabel)
        compose.onAllNodesWithContentDescription(searchLabel).assertCountEquals(1)
    }

    @Test
    fun fullDialogShowsTitleAndLabeledClose() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WidgetCatalogueDialog(
                    open = true,
                    onClose = {},
                    onAdd = {},
                    activeWidgetIds = emptyList(),
                    logger = NoopLogger,
                )
            }
        }

        compose
            .onNodeWithText(context.getString(R.string.translation_dashboard_catalogue_title))
            .assertIsDisplayed()
        compose
            .onNodeWithContentDescription(context.getString(R.string.translation_common_close))
            .assertIsDisplayed()
    }

    @Test
    fun fullDialogAddingWidgetInvokesOnAddThenClose() {
        val added = mutableListOf<String>()
        var closed = false
        val first = widgetCatalog.first()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WidgetCatalogueDialog(
                    open = true,
                    onClose = { closed = true },
                    onAdd = { added += it },
                    activeWidgetIds = emptyList(),
                    logger = NoopLogger,
                )
            }
        }

        val addLabel = context.getString(R.string.translation_dashboard_catalogue_addLabel, first.name)
        compose.onNodeWithContentDescription(addLabel).performClick()

        assertEquals(listOf(first.id), added)
        assertTrue(closed)
    }
}
