// Instrumented Compose UI + accessibility verification of [VehicleHeroCardContent] across the states the
// web VehicleHeroCard renders: the live-state hero (identity + four radial gauges + eight-cell stat grid
// + actions), the offline card (no `vehicleState` → identity + a friendly "offline" empty region + the
// actions, never a blank box), and the optional photo frame (carrying its localized alt text). It also
// asserts the accessibility names the surface exposes — the gauge content descriptions, the action-button
// labels, and the photo alt. The stateless renderer is driven with a deterministic projected display so
// this test never needs the unit-formatter state holder; the offline gate's `testReleaseUnitTest` covers
// the pure projection. Runs under `connectedAndroidTest` (a device/emulator). Mirrors the accepted
// MetricCardUiTest harness + assertion surface (createComposeRule + onNodeWith* + assertIsDisplayed).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicleherocard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class VehicleHeroCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        display: VehicleHeroCardDisplay,
        showPhoto: Boolean = false,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    VehicleHeroCardContent(display = display, showPhoto = showPhoto)
                }
            }
        }
    }

    @Test
    fun liveStateRendersIdentityGaugesAndStats() {
        setContent(sampleDisplay(hasState = true))
        // identity
        compose.onNodeWithText(NAME, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(VIN, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(MODEL, useUnmergedTree = true).assertIsDisplayed()
        // status badge (capitalized "driving")
        compose.onNodeWithText("Driving", useUnmergedTree = true).assertIsDisplayed()
        // each gauge exposes a "label: value" content description
        compose.onNodeWithContentDescription("Battery", substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Range", substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Inside", substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Outside", substring = true, useUnmergedTree = true).assertIsDisplayed()
        // stat grid labels + the lock / sentry values
        compose.onNodeWithText("Inside Temp", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Odometer", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Firmware", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Locked", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Off", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsIdentityAndFriendlyEmptyRegion() {
        setContent(sampleDisplay(hasState = false))
        // identity stays visible
        compose.onNodeWithText(NAME, useUnmergedTree = true).assertIsDisplayed()
        // the offline empty region renders (EmptyState exposes its message as a content description)
        compose.onNodeWithContentDescription("Offline", useUnmergedTree = true).assertIsDisplayed()
        // actions remain available even with no live state
        compose.onNodeWithText("Details", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun actionsAndGaugesExposeAccessibleNames() {
        setContent(sampleDisplay(hasState = true))
        // action buttons expose their labels as accessible names
        compose.onNodeWithText("Details", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Commands", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Live Map", useUnmergedTree = true).assertIsDisplayed()
        // a gauge exposes its spoken value
        compose.onNodeWithContentDescription("Battery", substring = true, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun photoFrameExposesItsAltText() {
        setContent(sampleDisplay(hasState = true), showPhoto = true)
        // the photo frame carries the localized alt ("<name> photo")
        compose.onNodeWithContentDescription("$NAME photo", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(NAME, useUnmergedTree = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun sampleDisplay(hasState: Boolean): VehicleHeroCardDisplay =
        VehicleHeroCardDisplay(
            name = NAME,
            vin = VIN,
            model = MODEL,
            status = if (hasState) "driving" else VEHICLE_HERO_OFFLINE,
            hasState = hasState,
            batteryGauge = VehicleHeroGauge(73.0, VEHICLE_HERO_BATTERY_MAX, VEHICLE_HERO_PERCENT, VehicleHeroAccent.Cyan),
            rangeGauge = VehicleHeroGauge(402.0, VEHICLE_HERO_RANGE_MAX_KM, "km", VehicleHeroAccent.Green),
            insideGauge = VehicleHeroGauge(21.0, VEHICLE_HERO_TEMP_MAX_C, "\u00B0C", VehicleHeroAccent.Amber),
            outsideGauge = VehicleHeroGauge(9.0, VEHICLE_HERO_TEMP_MAX_C, "\u00B0C", VehicleHeroAccent.Purple),
            distanceUnit = "km",
            temperatureUnit = "\u00B0C",
            insideTempText = if (hasState) "21" else VEHICLE_HERO_EM_DASH,
            outsideTempText = if (hasState) "9" else VEHICLE_HERO_EM_DASH,
            odometerText = if (hasState) "50,000" else VEHICLE_HERO_EM_DASH,
            rangeText = if (hasState) "402" else VEHICLE_HERO_EM_DASH,
            isLocked = true,
            sentryOn = false,
            firmware = if (hasState) "2025.1.0" else VEHICLE_HERO_EM_DASH,
            powerText = if (hasState) "0.00" else VEHICLE_HERO_EM_DASH,
        )

    private companion object {
        const val NAME = "My Tesla"
        const val VIN = "VIN-TEST-123"
        const val MODEL = "Model 3"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 920.dp
    }
}
