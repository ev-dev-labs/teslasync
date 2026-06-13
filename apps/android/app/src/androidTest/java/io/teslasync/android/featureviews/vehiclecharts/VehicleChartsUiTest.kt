package io.teslasync.android.featureviews.vehiclecharts

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
import java.time.ZoneOffset

/**
 * On-device Compose UI + accessibility verification of the VehicleCharts surface across the states it renders
 * WITHOUT a live base map: the loading skeleton, the empty surface, the hard error + retry, the populated
 * configuration + preference grids, the speed panel's "Position data will appear here" empty branch, and the
 * stale/offline freshness chip + refresh control. The live `TeslaMap` body needs Google Play Services on the
 * device, so — following the maps-layer testing contract and the sibling RouteMapSection UI test — every content
 * case uses a snapshot WITHOUT a location so no SDK map is composed; the opaque map body is covered by the
 * no-device [VehicleChartsModelTest] (trail / coordinate caption / summary). These assert the SDK-free chrome +
 * the screen-reader-visible labels, with strings supplied explicitly so the assertions are catalog-independent.
 */
class VehicleChartsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val zone = ZoneOffset.UTC

    private fun strings(): VehicleChartsStrings =
        VehicleChartsStrings(
            location = "Location",
            vehicleConfig = "Vehicle Configuration",
            carPreferences = "Car Display Preferences",
            speedHistory = "Speed History",
            positionDataWillAppear = "Position data will appear here",
            speed = "Speed",
            model = "Car Type",
            trim = "Trim",
            color = "Exterior Color",
            roof = "Roof Color",
            wheels = "Wheels",
            firmware = "Firmware",
            name = "Name",
            chargePort = "Charge Port",
            rearHeaters = "Rear Seat Heaters",
            efficiency = "Efficiency",
            sunroof = "Sunroof",
            europeVehicle = "Europe Vehicle",
            rhd = "Right-Hand Drive",
            remoteStart = "Remote Start",
            offroadLightbar = "Offroad Lightbar",
            swUpdate = "Software Update",
            swDownload = "Download",
            swInstall = "Install",
            prefDistance = "Distance",
            prefTemperature = "Temperature",
            prefChargeUnit = "Charge",
            prefTirePressure = "Tire Pressure",
            pref24hTime = "24-hour",
            yes = "Yes",
            no = "No",
            active = "Active",
            off = "Off",
            none = "None",
        )

    /** A content snapshot with NO location (so no live map renders) + populated grids + no positions. */
    private fun groundedSnapshot(): VehicleChartsSnapshot =
        VehicleChartsSnapshot(
            latitude = null,
            longitude = null,
            positions = emptyList(),
            config = VehicleChartsConfig(carType = "models2", trim = "P100D", europeVehicle = false),
            preferences = VehicleChartsPreferences(setting24hrTime = true, settingDistanceUnit = "DistanceUnitMiles"),
        )

    private fun setContent(
        state: UiState<VehicleChartsSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    VehicleChartsContent(
                        state = state,
                        onRetry = onRetry,
                        prefs = VehicleChartsDisplayPrefs.DEFAULT,
                        zone = zone,
                        strings = strings(),
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheFriendlyEmptyCopy() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("Position data will appear here", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentShowsEverySectionTitleAndAConfigValue() {
        setContent(UiState(UiPhase.Content, data = groundedSnapshot()))
        compose.onNodeWithText("Vehicle Configuration").assertIsDisplayed()
        compose.onNodeWithText("Car Display Preferences").assertIsDisplayed()
        compose.onNodeWithText("Speed History").assertIsDisplayed()
        compose.onNodeWithText("models2").assertIsDisplayed()
    }

    @Test
    fun contentWithNoPositionsShowsTheSpeedEmptyState() {
        setContent(UiState(UiPhase.Content, data = groundedSnapshot()))
        compose.onNodeWithText("Position data will appear here", substring = true).assertIsDisplayed()
    }

    @Test
    fun staleContentShowsTheOfflineFreshnessChipAndRefresh() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = groundedSnapshot(),
                fetchedAt = 1_000L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 1280.dp
    }
}
