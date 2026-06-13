package io.teslasync.android.sharedsurfaces.teslacarviz

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TeslaCarVizContent] across every state the web component
 * renders: idle, driving, charging + climate, sentry, locked vs unlocked, the battery readout, and the defensive
 * empty (null state) silhouette. Asserts the rendered i18n status chips and the TalkBack content description the
 * illustration exposes. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the projection
 * logic, this covers the render + a11y label.
 */
class TeslaCarVizUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        CarVizStrings(
            charging = "Charging",
            notCharging = "Not Charging",
            locked = "Locked",
            unlocked = "Unlocked",
            climate = "Climate",
            sentry = "Sentry",
        )

    private fun setContent(
        state: TeslaCarVizState?,
        model: TeslaModel = TeslaModel.Model3,
    ) {
        compose.setContent {
            TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
                TeslaCarVizContent(
                    state = state,
                    model = model,
                    size = TeslaCarVizSize.Md,
                    palette = carVizPalette(false),
                    strings = strings,
                )
            }
        }
    }

    @Test
    fun idleShowsBatteryChargeAndLockChips() {
        setContent(
            TeslaCarVizState(batteryLevel = 72, isCharging = false, isLocked = true, isClimateOn = false, sentryMode = false, speed = 0.0),
        )
        compose.onNodeWithText("72%").assertIsDisplayed()
        compose.onNodeWithText("Not Charging").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertIsDisplayed()
    }

    @Test
    fun chargingAndClimateShowTheirChips() {
        setContent(
            TeslaCarVizState(batteryLevel = 18, isCharging = true, isLocked = true, isClimateOn = true, sentryMode = false, speed = 0.0),
            model = TeslaModel.ModelS,
        )
        compose.onNodeWithText("Charging").assertIsDisplayed()
        compose.onNodeWithText("Climate").assertIsDisplayed()
    }

    @Test
    fun sentryAndUnlockedShowTheirChips() {
        setContent(
            TeslaCarVizState(batteryLevel = 90, isCharging = false, isLocked = false, isClimateOn = false, sentryMode = true, speed = 0.0),
            model = TeslaModel.ModelX,
        )
        compose.onNodeWithText("Unlocked").assertIsDisplayed()
        compose.onNodeWithText("Sentry").assertIsDisplayed()
    }

    @Test
    fun illustrationExposesTheVehicleStateSummary() {
        setContent(
            TeslaCarVizState(batteryLevel = 72, isCharging = false, isLocked = true, isClimateOn = false, sentryMode = false, speed = 0.0),
        )
        compose.onNodeWithContentDescription("Battery 72%, Not Charging, Locked", substring = true).assertIsDisplayed()
    }

    @Test
    fun drivingIsAnnouncedInTheSummary() {
        setContent(
            TeslaCarVizState(batteryLevel = 48, isCharging = false, isLocked = true, isClimateOn = false, sentryMode = false, speed = 65.0),
            model = TeslaModel.ModelY,
        )
        compose.onNodeWithContentDescription("Driving", substring = true).assertIsDisplayed()
    }

    @Test
    fun cybertruckRendersWithStatusChips() {
        setContent(
            TeslaCarVizState(batteryLevel = 33, isCharging = true, isLocked = false, isClimateOn = false, sentryMode = false, speed = 40.0),
            model = TeslaModel.Cybertruck,
        )
        compose.onNodeWithText("33%").assertIsDisplayed()
        compose.onNodeWithText("Charging").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsTheFriendlyCaption() {
        setContent(state = null)
        compose.onNodeWithText("No data available").assertIsDisplayed()
        compose.onNodeWithContentDescription("No data available", substring = true).assertIsDisplayed()
    }
}
