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
 * renders: a loaded vehicle (bold title + capitalized status chip + "model trim · VIN" subtitle), a not-yet-loaded
 * vehicle (the `common.vehicle` title fallback + the status chip + the Wake action present, subtitle collapsed but
 * never a blank box), the back affordance's TalkBack content description firing [onBack], and the Wake action
 * firing [onWake]. The offline gate's `testReleaseUnitTest` covers the pure projection + adapter + diagnostics;
 * this covers render + a11y. Mirrors the web spec (web/src/features/vehicles/components/VehicleHeader.tsx).
 */
class VehicleHeaderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun loaded(status: String = "online"): VehicleHeaderUiModel =
        VehicleHeaderProjection.project(
            VehicleHeaderData(
                displayName = "My Model 3",
                vin = "5YJ3E1EA7KF000001",
                model = "Model 3",
                trim = "Long Range",
                status = status,
            ),
        )

    private fun unloaded(): VehicleHeaderUiModel =
        VehicleHeaderProjection.project(
            VehicleHeaderData(displayName = null, vin = null, model = null, trim = null, status = "offline"),
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
    fun loadedVehicleRendersTitleStatusDescriptorAndVin() {
        setContent(loaded())
        compose.onNodeWithText("My Model 3").assertIsDisplayed()
        // The shared StatusBadge capitalizes the raw token.
        compose.onNodeWithText("Online").assertIsDisplayed()
        compose.onNodeWithText("Model 3 Long Range", substring = true).assertIsDisplayed()
        compose.onNodeWithText("5YJ3E1EA7KF000001").assertIsDisplayed()
    }

    @Test
    fun notYetLoadedVehicleStillRendersTitleFallbackStatusChipAndWakeAction() {
        setContent(unloaded())
        // web `|| t('common.vehicle', 'Vehicle')`.
        compose.onNodeWithText("Vehicle").assertIsDisplayed()
        compose.onNodeWithText("Offline").assertIsDisplayed()
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
