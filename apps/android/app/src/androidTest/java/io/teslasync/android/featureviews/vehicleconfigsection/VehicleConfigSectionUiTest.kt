package io.teslasync.android.featureviews.vehicleconfigsection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [VehicleConfigSectionContent] across every branch the
 * web component renders (the "Vehicle Configuration" header over the twelve label/value rows, including the
 * three Yes/No boolean rows and the em-dash fallbacks) plus the lifecycle chrome the host's feed implies
 * (loading skeletons, a hard-error retry surface, a friendly empty body, and the stale/offline freshness chip).
 * Asserts the rendered labels/values are exposed to TalkBack, that the empty state never blanks, and that the
 * retry affordance carries an accessible click action. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx).
 */
class VehicleConfigSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        VehicleConfigSectionStrings(
            title = "Vehicle Configuration",
            carType = "Car Type",
            trim = "Trim",
            exteriorColor = "Exterior Color",
            wheels = "Wheels",
            roofColor = "Roof Color",
            chargePort = "Charge Port",
            rightHandDrive = "Right-Hand Drive",
            europeVehicle = "Europe Vehicle",
            offroadLightbar = "Offroad Lightbar",
            rearSeatHeaters = "Rear Seat Heaters",
            sunroof = "Sunroof",
            software = "Software",
            yes = "Yes",
            no = "No",
            noData = "No data available",
        )

    private val config =
        VehicleConfigData(
            carType = "Model S",
            trim = "P100D",
            exteriorColor = "Midnight Silver",
            wheelType = "Arachnid",
            roofColor = "Glass",
            chargePort = "US",
            rightHandDrive = true,
            europeVehicle = false,
            offroadLightbarPresent = true,
            rearSeatHeaters = "1",
            sunroofInstalled = "None",
            softwareUpdateVersion = "2026.8.1",
        )

    private fun setContent(
        state: UiState<VehicleConfigData>,
        softwareVersion: String? = null,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    VehicleConfigSectionContent(
                        state = state,
                        onRetry = onRetry,
                        softwareVersion = softwareVersion,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsHeaderEveryLabelAndRepresentativeValues() {
        setContent(UiState(phase = UiPhase.Content, data = config))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every row label is exposed to TalkBack.
        compose.onNodeWithText(strings.carType).assertExists()
        compose.onNodeWithText(strings.trim).assertExists()
        compose.onNodeWithText(strings.exteriorColor).assertExists()
        compose.onNodeWithText(strings.wheels).assertExists()
        compose.onNodeWithText(strings.roofColor).assertExists()
        compose.onNodeWithText(strings.chargePort).assertExists()
        compose.onNodeWithText(strings.rightHandDrive).assertExists()
        compose.onNodeWithText(strings.europeVehicle).assertExists()
        compose.onNodeWithText(strings.offroadLightbar).assertExists()
        compose.onNodeWithText(strings.rearSeatHeaters).assertExists()
        compose.onNodeWithText(strings.sunroof).assertExists()
        compose.onNodeWithText(strings.software).assertExists()
        // Representative formatted values: a string field, a true/false boolean, and the software version.
        compose.onNodeWithText("Model S").assertExists()
        compose.onNodeWithText("Yes").assertExists()
        compose.onNodeWithText("No").assertExists()
        compose.onNodeWithText("2026.8.1").assertExists()
    }

    @Test
    fun softwareRowFallsBackToSoftwareVersionProp() {
        setContent(
            state = UiState(phase = UiPhase.Content, data = config.copy(softwareUpdateVersion = null)),
            softwareVersion = "2026.2.0",
        )
        compose.onNodeWithText(strings.software).assertExists()
        compose.onNodeWithText("2026.2.0").assertExists()
    }

    @Test
    fun loadingShowsTitleChromeButNoRows() {
        setContent(UiState.loading())
        // The header is static chrome and stays visible; the value rows are replaced by skeletons.
        compose.onNodeWithText(strings.title).assertExists()
        compose.onNodeWithText(strings.carType).assertDoesNotExist()
        compose.onNodeWithText("Model S").assertDoesNotExist()
    }

    @Test
    fun emptyStillRendersTitleAndAFriendlyMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        // The empty phase keeps the header and shows the no-data message, never a blank box.
        compose.onNodeWithText(strings.title).assertExists()
        compose.onNodeWithText(strings.noData).assertExists()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsCachedRowsWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = config,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached panel visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText("Model S").assertExists()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            UiState(phase = UiPhase.Content, data = config, stale = true, fetchedAt = 1_700_000_000_000L),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        assertTrue(refreshed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.width(HOST_WIDTH).verticalScroll(rememberScrollState())) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
    }
}
