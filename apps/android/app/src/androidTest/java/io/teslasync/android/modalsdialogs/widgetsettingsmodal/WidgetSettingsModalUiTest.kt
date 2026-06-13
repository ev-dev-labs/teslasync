// Instrumented Compose UI + accessibility verification of the WidgetSettingsModal surface across the branches the web
// component renders (web/src/features/dashboard/components/WidgetSettingsModal.tsx): the category-gated sections
// (vehicle picker only for vehicle-scoped widgets, time-range only for chart widgets, refresh + appearance always),
// the vehicle-feed cache-phase chrome (loading / empty / stale / offline / hard error + retry), the show-title toggle,
// and the Cancel / Save hand-offs (Save returns the edited config then closes). Every asserted label is the localized
// copy the surface exposes to TalkBack, and every interactive element is checked for an accessible name/role. Runs
// under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + the view-model.
package io.teslasync.android.modalsdialogs.widgetsettingsmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

class WidgetSettingsModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        def: WidgetDefInfo = vehicleDef,
        widget: WidgetInstanceInfo = WidgetInstanceInfo("i1", "w1", WidgetConfig()),
        vehiclesState: UiState<List<Vehicle>> = content(),
        onSave: (WidgetConfig) -> Unit = {},
        onClose: () -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    WidgetSettingsModalContent(
                        def = def,
                        widget = widget,
                        vehiclesState = vehiclesState,
                        strings = rememberWidgetSettingsStrings(),
                        onSave = onSave,
                        onClose = onClose,
                        onRefreshVehicles = onRefresh,
                    )
                }
            }
        }
    }

    @Test
    fun vehicleWidgetRendersAllSectionsAndActions() {
        setContent()
        compose.onNodeWithText(VEHICLE_TITLE).assertIsDisplayed()
        compose.onNodeWithText(REFRESH_TITLE).assertIsDisplayed()
        compose.onNodeWithText(APPEARANCE_TITLE).assertIsDisplayed()
        compose.onNodeWithText(ALL_VEHICLES).assertIsDisplayed()
        compose.onNodeWithText(CANCEL).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(SAVE).assertIsDisplayed().assertHasClickAction()
        // A non-chart vehicle widget hides the time-range section (web `isChartWidget` false).
        compose.onNodeWithTag(WidgetSettingsModalTestTags.TIME_RANGE_SELECT).assertDoesNotExist()
    }

    @Test
    fun chartWidgetAlsoShowsTheTimeRangeSection() {
        setContent(def = chartDef)
        compose.onNodeWithText(VEHICLE_TITLE).assertIsDisplayed()
        compose.onNodeWithText(TIME_RANGE_TITLE).assertIsDisplayed()
        compose.onNodeWithTag(WidgetSettingsModalTestTags.TIME_RANGE_SELECT).assertIsDisplayed()
    }

    @Test
    fun analyticsWidgetHidesVehicleButKeepsTimeRange() {
        setContent(def = analyticsDef)
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_SELECT).assertDoesNotExist()
        compose.onNodeWithText(TIME_RANGE_TITLE).assertIsDisplayed()
        compose.onNodeWithText(REFRESH_TITLE).assertIsDisplayed()
    }

    @Test
    fun systemWidgetHidesVehicleAndTimeRange() {
        setContent(def = systemDef)
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_SELECT).assertDoesNotExist()
        compose.onNodeWithTag(WidgetSettingsModalTestTags.TIME_RANGE_SELECT).assertDoesNotExist()
        compose.onNodeWithText(REFRESH_TITLE).assertIsDisplayed()
        compose.onNodeWithText(APPEARANCE_TITLE).assertIsDisplayed()
    }

    @Test
    fun loadingStateShowsLoadingChrome() {
        setContent(vehiclesState = UiState.loading())
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_LOADING).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsFriendlyNoteNeverBlank() {
        setContent(vehiclesState = UiState(UiPhase.Empty, data = emptyList(), fetchedAt = 100L))
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_EMPTY).assertIsDisplayed()
        compose.onNodeWithText(VEHICLES_EMPTY).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsUpdatingChip() {
        setContent(vehiclesState = UiState(UiPhase.Content, data = vehicles(), refreshing = true))
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_STALE).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsLastKnownWithRetry() {
        var retried = false
        setContent(
            vehiclesState = UiState(UiPhase.Content, data = vehicles(), stale = true, errorKind = ErrorKind.Timeout),
            onRefresh = { retried = true },
        )
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_OFFLINE).assertIsDisplayed()
        compose.onNodeWithText(RETRY).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(RETRY).performClick()
        assertTrue("the offline retry affordance must invoke onRefresh", retried)
    }

    @Test
    fun hardErrorStateShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            vehiclesState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_ERROR).assertIsDisplayed()
        compose.onNodeWithText(VEHICLES_ERROR).assertIsDisplayed()
        compose.onNodeWithText(RETRY).performClick()
        assertTrue("the error retry affordance must invoke onRefresh", retried)
    }

    @Test
    fun saveHandsBackConfigAndCloses() {
        var saved: WidgetConfig? = null
        var closed = false
        setContent(onSave = { saved = it }, onClose = { closed = true })
        compose.onNodeWithTag(WidgetSettingsModalTestTags.SAVE).performClick()
        assertEquals(WidgetConfig(), saved)
        assertTrue("Save must dismiss the dialog", closed)
    }

    @Test
    fun cancelClosesWithoutSaving() {
        var saved: WidgetConfig? = null
        var closed = false
        setContent(onSave = { saved = it }, onClose = { closed = true })
        compose.onNodeWithTag(WidgetSettingsModalTestTags.CANCEL).performClick()
        assertNull("Cancel must not save", saved)
        assertTrue("Cancel must dismiss the dialog", closed)
    }

    @Test
    fun togglingShowTitleIsReflectedInTheSavedConfig() {
        var saved: WidgetConfig? = null
        setContent(onSave = { saved = it })
        compose.onNodeWithText(SHOW_TITLE).assertIsDisplayed()
        compose.onNodeWithTag(WidgetSettingsModalTestTags.SHOW_TITLE_TOGGLE).performClick()
        compose.onNodeWithTag(WidgetSettingsModalTestTags.SAVE).performClick()
        assertEquals("toggling off must persist showTitle=false", false, saved?.showTitle)
    }

    @Test
    fun interactiveElementsExposeAccessibleNames() {
        setContent()
        // The switch carries its label as its accessible name (Material Role.Switch on the whole row).
        compose.onNodeWithText(SHOW_TITLE).assertIsDisplayed().assertHasClickAction()
        // The footer actions are reachable by their localized labels with click actions.
        compose.onNodeWithText(CANCEL).assertHasClickAction()
        compose.onNodeWithText(SAVE).assertHasClickAction()
        // The vehicle dropdown anchor is present (its selected value names it for TalkBack).
        compose.onNodeWithTag(WidgetSettingsModalTestTags.VEHICLE_SELECT).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val VEHICLE_TITLE = "Vehicle"
        const val REFRESH_TITLE = "Refresh Interval"
        const val TIME_RANGE_TITLE = "Time Range"
        const val APPEARANCE_TITLE = "Appearance"
        const val SHOW_TITLE = "Show widget title"
        const val ALL_VEHICLES = "All Vehicles (first)"
        const val VEHICLES_EMPTY = "No vehicles available"
        const val VEHICLES_ERROR = "Couldn't load vehicles"
        const val CANCEL = "Cancel"
        const val SAVE = "Save"
        const val RETRY = "Retry"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1000.dp

        val vehicleDef = WidgetDefInfo(id = "battery-health", name = "Battery Health", category = WidgetCategory.Vehicle)
        val chartDef = WidgetDefInfo(id = "charge-curve", name = "Charge Curve", category = WidgetCategory.Charging)
        val analyticsDef = WidgetDefInfo(id = "fleet-tco", name = "Fleet TCO", category = WidgetCategory.Analytics)
        val systemDef = WidgetDefInfo(id = "system-status", name = "System Status", category = WidgetCategory.System)

        fun vehicles(): List<Vehicle> = listOf(vehicle(5, "Garage"), vehicle(9, "Cabin"))

        fun content(): UiState<List<Vehicle>> = UiState(UiPhase.Content, data = vehicles(), fetchedAt = 100L)

        fun vehicle(
            id: Long,
            name: String,
        ): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = name,
                enrolledAt = Instant.fromEpochSeconds(0),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN$id",
            )
    }
}
