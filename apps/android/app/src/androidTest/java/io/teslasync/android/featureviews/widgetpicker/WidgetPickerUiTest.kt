package io.teslasync.android.featureviews.widgetpicker

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [WidgetPickerContent] across the render branches the
 * web component defines (web/src/features/dashboard/components/WidgetPicker.tsx): the grouped catalogue with
 * Layout-Presets, the searching results list (non-matches hidden), the empty "no widgets match" state, the
 * per-widget already-added state, card taps, and the session footer. Accessibility is checked via the search
 * field tag, the category-filter group label, and the labeled close affordance. All visible copy is resolved
 * from the app's i18n resources so the test follows the device locale rather than hard-coding English. Uses
 * only the assertion API the sibling AddWidgetButton UI test relies on (assertIsDisplayed / assertCountEquals).
 * Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection.
 */
class WidgetPickerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val catalog =
        listOf(
            PickerWidget("battery-gauge", "Battery Level", "Battery percentage with radial gauge", WidgetCategory.Battery, 1, 2),
            PickerWidget("charge-status", "Charge Status", "Current charge state, amps", WidgetCategory.Charging, 2, 2),
            PickerWidget("location-map", "Vehicle Location Map", "Live map of vehicle position", WidgetCategory.Maps, 2, 4),
        )

    private fun render(
        input: WidgetPickerInput,
        onAddWidget: (PickerWidget) -> Unit = {},
        onClose: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.fillMaxSize()) {
                    WidgetPickerContent(
                        searchText = input.search,
                        categoryFilter = input.categoryFilter,
                        activeWidgetIds = input.activeWidgetIds,
                        view = WidgetPickerProjection.project(input, catalog, widgetPresets),
                        announcementText = "",
                        onSearchChange = {},
                        onSelectCategory = {},
                        onAddWidget = onAddWidget,
                        onAddAll = {},
                        onApplyPreset = {},
                        onClose = onClose,
                    )
                }
            }
        }
    }

    @Test
    fun groupedStateShowsTitlePresetsAndSearchField() {
        render(WidgetPickerInput())

        compose.onNodeWithText(context.getString(R.string.translation_dashboard_addWidget)).assertIsDisplayed()
        compose.onNodeWithTag(WidgetPickerRegistration.SEARCH_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.translation_dashboard_presets)).assertIsDisplayed()
        compose.onNodeWithText("Default").assertIsDisplayed()
    }

    @Test
    fun searchingStateShowsMatchAndHidesNonMatches() {
        render(WidgetPickerInput(search = "battery"))

        compose.onNodeWithText("Battery Level").assertIsDisplayed()
        compose.onAllNodesWithText("Charge Status").assertCountEquals(0)
        compose.onAllNodesWithText(context.getString(R.string.translation_dashboard_presets)).assertCountEquals(0)
    }

    @Test
    fun emptyStateShowsNoResultsMessage() {
        render(WidgetPickerInput(search = "zzz"))

        compose.onNodeWithText(context.getString(R.string.translation_widgets_noResults, "zzz")).assertIsDisplayed()
    }

    @Test
    fun addedWidgetShowsAddedBadge() {
        render(WidgetPickerInput(search = "battery", activeWidgetIds = setOf("battery-gauge")))

        compose.onNodeWithText(context.getString(R.string.translation_dashboard_added)).assertIsDisplayed()
    }

    @Test
    fun tappingWidgetCardInvokesOnAddWidget() {
        val added = mutableListOf<String>()
        render(WidgetPickerInput(search = "charge"), onAddWidget = { added += it.id })

        compose.onNodeWithTag(WidgetPickerRegistration.WIDGET_TAG_PREFIX + "charge-status").performClick()

        assertEquals(listOf("charge-status"), added)
    }

    @Test
    fun footerShowsDoneAndCountAfterAddingThisSession() {
        render(WidgetPickerInput(addedThisSessionIds = setOf("battery-gauge")))

        compose.onNodeWithText(context.getString(R.string.translation_dashboard_done)).assertIsDisplayed()
        val countText = context.resources.getQuantityString(R.plurals.translation_widgets_addedCount, 1, 1)
        compose.onNodeWithText(countText).assertIsDisplayed()
    }

    @Test
    fun closeAffordanceIsLabeledAndInvokesClose() {
        var closed = false
        render(WidgetPickerInput(), onClose = { closed = true })

        val closeLabel = context.getString(R.string.translation_common_close)
        compose.onNodeWithContentDescription(closeLabel).assertIsDisplayed().performClick()

        assertEquals(true, closed)
    }

    @Test
    fun categoryFilterExposesAccessibilityLabel() {
        render(WidgetPickerInput())

        val filterLabel = context.getString(R.string.translation_widgets_categoryFilter)
        compose.onAllNodesWithContentDescription(filterLabel, useUnmergedTree = true).assertCountEquals(1)
    }
}
