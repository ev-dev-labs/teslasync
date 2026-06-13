package io.teslasync.android.featureviews.vehicleheader

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [VehicleHeaderContent] across the branches the surface
 * renders: a loaded vehicle (status chip token + "model trim" chip + monospace VIN), a not-yet-loaded vehicle
 * (status chip + Wake action present, identity chrome collapsed but never a blank box), the back affordance's
 * TalkBack content description firing [onBack], and the Wake action firing [onWake]. The offline gate's
 * `testReleaseUnitTest` covers the pure projection + diagnostics; this covers render + a11y. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/VehicleHeader.tsx).
 */
class VehicleHeaderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun loaded(status: String = "online"): VehicleHeaderUiModel =
        VehicleHeaderProjection.project(
            VehicleHeaderData(
                model = "Model 3",
                trimBadging = "Long Range",
                vin = "5YJ3E1EA7KF000001",
                status = status,
            ),
        )

    private fun unloaded(): VehicleHeaderUiModel =
        VehicleHeaderProjection.project(
            VehicleHeaderData(model = null, trimBadging = null, vin = null, status = "offline"),
        )

    private fun setContent(
        model: VehicleHeaderUiModel,
        waking: Boolean = false,
        onBack: () -> Unit = {},
        onWake: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleHeaderContent(model = model, onBack = onBack, onWake = onWake, waking = waking)
            }
        }
    }

    @Test
    fun loadedVehicleRendersStatusDescriptorAndVin() {
        setContent(loaded())
        compose.onNodeWithText("online").assertIsDisplayed()
        compose.onNodeWithText("Model 3 Long Range").assertIsDisplayed()
        compose.onNodeWithText("5YJ3E1EA7KF000001").assertIsDisplayed()
    }

    @Test
    fun notYetLoadedVehicleStillRendersStatusChipAndWakeAction() {
        setContent(unloaded())
        compose.onNodeWithText("offline").assertIsDisplayed()
        compose.onNodeWithText("Wake Up").assertIsDisplayed()
    }

    @Test
    fun backAffordanceIsLabeledForTalkBackAndInvokesOnBack() {
        var backed = false
        setContent(loaded(), onBack = { backed = true })
        compose.onNodeWithContentDescription("Back").assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        assertTrue(backed)
    }

    @Test
    fun wakeActionIsAClickableControlThatInvokesOnWake() {
        var woke = false
        setContent(loaded(), onWake = { woke = true })
        compose.onNodeWithText("Wake Up").assertHasClickAction()
        compose.onNodeWithText("Wake Up").performClick()
        assertTrue(woke)
    }
}
