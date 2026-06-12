package io.teslasync.android.featureviews.vehiclecommandcenter

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the VehicleCommandCenter across every state the
 * surface renders (web/src/features/system/components/VehicleCommandCenter.tsx): the content / loading /
 * error / stale-offline chrome over the always-present command grid, the asleep banner, the post-command
 * feedback panel, the search-empty surface, the favourites bar, the routed confirm dialog, and the
 * accessibility contract (a labelled favourite toggle + a clickable category header carrying an
 * expand/collapse `stateDescription`). Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure model logic.
 */
class VehicleCommandCenterUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        latest: UiState<List<CommandLogEntry>> = UiState(UiPhase.Content, data = emptyList()),
        vehicle: CommandCenterVehicle = ONLINE_VEHICLE,
        vehicleState: CommandCenterVehicleState? = VEHICLE_STATE,
        lastResult: CommandResultFeedback? = null,
        dialog: DialogRequest? = null,
        search: String = "",
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleCommandCenterContent(
                    vehicle = vehicle,
                    vehicleState = vehicleState,
                    commands = DEFAULT_COMMAND_CATALOG,
                    latest = latest,
                    favorites = VehicleCommandCenterProjection.defaultFavorites(DEFAULT_COMMAND_CATALOG),
                    inFlightCommand = null,
                    lastResult = lastResult,
                    dialog = dialog,
                    search = search,
                    formatter = UnitFormatter.default(),
                    lookup = { null },
                    onSearchChange = {},
                    onExecute = { _, _ -> },
                    onToggleFavorite = {},
                    onRequestDialog = {},
                    onDialogSubmit = { _, _ -> },
                    onDialogDismiss = {},
                    onRetry = {},
                )
            }
        }
    }

    @Test
    fun rendersTheVehicleHeaderAndCommandGrid() {
        setContent()
        compose.onNodeWithText(VEHICLE_NAME).assertIsDisplayed()
        compose.onAllNodesWithText(WAKE_LABEL).onFirst().assertIsDisplayed()
    }

    @Test
    fun loadingStateStillRendersTheStaticGrid() {
        setContent(latest = UiState(UiPhase.Loading))
        compose.onNodeWithText(VEHICLE_NAME).assertIsDisplayed()
        compose.onAllNodesWithText(WAKE_LABEL).onFirst().assertIsDisplayed()
    }

    @Test
    fun errorStateStillRendersTheStaticGrid() {
        setContent(latest = UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onAllNodesWithText(WAKE_LABEL).onFirst().assertIsDisplayed()
    }

    @Test
    fun offlineStateStillRendersTheStaticGrid() {
        setContent(
            latest =
                UiState(
                    phase = UiPhase.Content,
                    data = emptyList(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.onAllNodesWithText(WAKE_LABEL).onFirst().assertIsDisplayed()
    }

    @Test
    fun asleepVehicleShowsTheWakeBanner() {
        setContent(vehicle = ASLEEP_VEHICLE)
        compose.onNodeWithText(WAKE_FIRST, substring = true).assertIsDisplayed()
    }

    @Test
    fun searchWithNoMatchesShowsTheEmptySurface() {
        setContent(search = "zzzzzz")
        compose.onNodeWithText(NO_RESULTS).assertIsDisplayed()
    }

    @Test
    fun lastResultRendersTheFeedbackMessage() {
        setContent(lastResult = CommandResultFeedback(success = true, message = RESULT_MESSAGE))
        compose.onNodeWithText(RESULT_MESSAGE).assertIsDisplayed()
    }

    @Test
    fun confirmDialogShowsForADangerousCommand() {
        val erase = DEFAULT_COMMAND_CATALOG.first { it.id == "erase_user_data" }
        setContent(dialog = DialogRequest(DialogKind.Confirm, erase))
        compose.onNodeWithText(ERASE_CONFIRM, substring = true).assertIsDisplayed()
    }

    @Test
    fun favouriteToggleExposesAnAccessibleLabel() {
        setContent()
        compose.onAllNodesWithContentDescription(TOGGLE_FAVORITE).onFirst().assertIsDisplayed()
    }

    @Test
    fun categoryHeaderIsClickableWithAStateDescription() {
        setContent()
        compose
            .onNode(hasClickAction() and hasText(SECURITY_LABEL, substring = true))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, COLLAPSE_AFFORDANCE))
    }

    private companion object {
        const val VEHICLE_NAME = "Model 3"
        const val WAKE_LABEL = "Wake Up"
        const val WAKE_FIRST = "Wake it up first"
        const val NO_RESULTS = "No commands match your search"
        const val RESULT_MESSAGE = "Doors locked"
        const val ERASE_CONFIRM = "erase all user data"
        const val TOGGLE_FAVORITE = "Toggle favorite"
        const val SECURITY_LABEL = "SECURITY & ACCESS"
        const val COLLAPSE_AFFORDANCE = "Click to collapse"

        val ONLINE_VEHICLE =
            CommandCenterVehicle(
                id = 1L,
                vin = "5YJ3E1EA7KF000000",
                displayName = "Model 3",
                model = "Model 3",
                state = "online",
                batteryLevel = 72,
                batteryRange = 300_000.0,
                updatedAt = "2026-06-12T12:00:00Z",
            )

        val ASLEEP_VEHICLE = ONLINE_VEHICLE.copy(state = "asleep")

        val VEHICLE_STATE =
            CommandCenterVehicleState(
                batteryLevel = 72,
                ratedRange = 300_000.0,
                isLocked = true,
                isCharging = false,
                isClimateOn = false,
                sentryMode = false,
                insideTemp = 21.0,
                speed = 0.0,
            )
    }
}
