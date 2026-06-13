package io.teslasync.android.sharedsurfaces.pollingengine

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [PollingEngineContent] across every state the web
 * component renders plus the status document's lifecycle: the savings card (stats + cost-attribution legend),
 * the per-vehicle row, the empty-vehicles hint, the loading skeleton, the classified error + retry, and the
 * stale / offline freshness chips, plus the disabled-engine gate that renders nothing. Asserts the rendered
 * i18n strings and the TalkBack content description on the vehicle row. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the logic, this covers the render.
 */
class PollingEngineUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        PollingEngineStrings(
            title = "Savings",
            active = "Active",
            vehicleActivity = "Vehicles",
            noVehicles = "No vehicle data",
            nextLabel = "Next",
            nowLabel = "Now",
            pollsSaved = "Polls Saved",
            savedAmount = "$ Saved",
            pollsMade = "Polls Made",
            creditLeft = "Credit Left",
            fleetTelemetry = "Fleet Telemetry",
            idleDetection = "Idle Detection",
            prediction = "Prediction",
            sleep = "Sleep",
            profileDriving = "Driving",
            profileCharging = "Charging",
            profileIdle = "Idle",
            profileSleeping = "Sleeping",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
        )

    private fun savings(): PollingSavingsView =
        PollingSavingsView(
            savingsPercentText = "42.5",
            estimatedSavingsText = "12.30",
            pollsMadeText = "1840",
            remainingCreditText = "5.00",
            hasBreakdown = true,
            segments =
                listOf(
                    BreakdownSegment(BreakdownKind.FleetTelemetry, 0.50f),
                    BreakdownSegment(BreakdownKind.IdleDetection, 0.30f),
                    BreakdownSegment(BreakdownKind.Prediction, 0.15f),
                    BreakdownSegment(BreakdownKind.Sleep, 0.05f),
                ),
        )

    private fun vehicles(): List<VehicleRowView> =
        listOf(
            VehicleRowView(
                vinTail = "ABCD1234",
                activityRaw = "active",
                activityKind = PollingActivityKind.Active,
                profileKind = PollingProfileKind.Driving,
                profileRaw = "driving",
                countdownText = "5m",
                isNow = false,
            ),
        )

    private fun setContent(
        display: PollingDisplay,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PollingEngineContent(display = display, strings = strings, onRetry = onRetry)
            }
        }
    }

    @Test
    fun contentShowsTitleSavingsAndVehicle() {
        setContent(PollingDisplay(phase = PollingPhase.Content, savings = savings(), vehicles = vehicles()))
        compose.onNodeWithText("Savings").assertIsDisplayed()
        compose.onNodeWithText("Active").assertIsDisplayed()
        compose.onNodeWithText("42.5%").assertIsDisplayed()
        compose.onNodeWithText("Polls Saved").assertIsDisplayed()
        compose.onNodeWithText("Fleet Telemetry").assertIsDisplayed()
        compose.onNodeWithText("ABCD1234").assertIsDisplayed()
        compose.onNodeWithText("Next: 5m").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoVehiclesMessage() {
        setContent(PollingDisplay(phase = PollingPhase.Empty, savings = savings()))
        compose.onNodeWithText("No vehicle data").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(PollingDisplay(phase = PollingPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            display = PollingDisplay(phase = PollingPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleShowsStaleChip() {
        setContent(
            PollingDisplay(
                phase = PollingPhase.Content,
                savings = savings(),
                vehicles = vehicles(),
                stale = true,
                refreshing = true,
            ),
        )
        compose.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun offlineShowsOfflineChip() {
        setContent(
            PollingDisplay(
                phase = PollingPhase.Content,
                savings = savings(),
                vehicles = vehicles(),
                offline = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun disabledEngineRendersNothing() {
        setContent(PollingDisplay(phase = PollingPhase.Hidden))
        compose.onNodeWithText("Savings").assertDoesNotExist()
    }

    @Test
    fun vehicleRowExposesSpokenLabel() {
        setContent(PollingDisplay(phase = PollingPhase.Content, savings = savings(), vehicles = vehicles()))
        compose.onNodeWithContentDescription("ABCD1234, active, Driving, Next 5m", substring = true).assertIsDisplayed()
    }

    private companion object {
        const val HTTP_SERVER_ERROR = 503
    }
}
