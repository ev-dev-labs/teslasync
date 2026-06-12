package io.teslasync.android.featureviews.vehiclestatepanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [VehicleStatePanelContent] across the branches the
 * web component renders (web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx): the
 * connected panel with live values and the pulsing "Live" indicator, and the disconnected/empty panel that
 * withholds the indicator yet still renders every titled row with its fallback (never a blank box). Every
 * asserted string is resolved from the app's i18n resources so the test follows the device locale rather than
 * hard-coding English. The clock auto-advance is disabled so the "Live" dot's infinite pulse cannot stall
 * `waitForIdle`. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the
 * projection.
 */
class VehicleStatePanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private fun populatedLive() =
        VehicleLiveState(
            lightsHighBeams = true,
            lightsTurnSignal = JsonPrimitive("Left"),
            lightsHazards = false,
            driverSeatOccupied = true,
            pairedKeyCount = JsonPrimitive(3),
            valetMode = false,
            serviceMode = false,
            speedLimitMode = true,
            currentSpeedLimit = SPEED_MPS,
            centerDisplay = JsonPrimitive("Drive"),
            homelinkDeviceCount = JsonPrimitive(2),
        )

    private fun setContent(
        live: VehicleLiveState,
        sseConnected: Boolean,
        width: Dp = PHONE_WIDTH,
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT)) {
                    VehicleStatePanelContent(
                        display = VehicleStatePanelProjection.project(live, sseConnected, UnitFormatter.default()),
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    @Test
    fun connectedShowsTheTitleEveryLabelTheLiveIndicatorAndResolvedValues() {
        setContent(populatedLive(), sseConnected = true)

        compose.onNodeWithText(string(R.string.translation_telemetry_vehicleState)).assertIsDisplayed()
        for (labelId in ROW_LABEL_IDS) {
            compose.onNodeWithText(string(labelId)).assertIsDisplayed()
        }
        // The "Live" indicator renders when the SSE stream is connected.
        compose.onNodeWithText(string(R.string.translation_admin_security_live_indicator)).assertIsDisplayed()
        // Distinct projected values render (passthrough strings, a stringified count, the SI→display speed).
        compose.onNodeWithText("Left").assertIsDisplayed()
        compose.onNodeWithText("Drive").assertIsDisplayed()
        compose.onNodeWithText("3").assertIsDisplayed()
        compose.onNodeWithText(UnitFormatter.default().speed(SPEED_MPS)).assertIsDisplayed()
    }

    @Test
    fun disconnectedEmptyKeepsEveryRowWithFallbacksAndHidesTheLiveIndicator() {
        setContent(VehicleLiveState(), sseConnected = false)

        // The titled panel and every row still render — never a blank box.
        compose.onNodeWithText(string(R.string.translation_telemetry_vehicleState)).assertIsDisplayed()
        for (labelId in ROW_LABEL_IDS) {
            compose.onNodeWithText(string(labelId)).assertIsDisplayed()
        }
        // Driver seat degrades to "Empty"; the indicator is withheld while disconnected.
        compose.onNodeWithText(string(R.string.translation_admin_security_live_empty)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_live_indicator)).assertDoesNotExist()
    }

    @Test
    fun everyRowLabelIsPresentAsAnAccessibleNode() {
        // a11y: each row is a merged TalkBack node carrying its label, and the title renders.
        setContent(populatedLive(), sseConnected = true)

        compose.onNodeWithText(string(R.string.translation_telemetry_vehicleState)).assertIsDisplayed()
        for (labelId in ROW_LABEL_IDS) {
            compose.onNodeWithText(string(labelId)).assertIsDisplayed()
        }
    }

    private companion object {
        val PHONE_WIDTH = 360.dp
        val HOST_HEIGHT = 1024.dp
        const val SETTLE_MS = 2_000L
        const val SPEED_MPS = 26.8

        val ROW_LABEL_IDS =
            listOf(
                R.string.translation_admin_security_live_highBeams,
                R.string.translation_admin_security_live_turnSignal,
                R.string.translation_admin_security_live_hazards,
                R.string.translation_admin_security_live_driverSeat,
                R.string.translation_admin_security_live_pairedKeys,
                R.string.translation_admin_security_live_valetMode,
                R.string.translation_admin_security_live_serviceMode,
                R.string.translation_admin_security_live_speedLimit,
                R.string.translation_admin_security_live_centerDisplay,
                R.string.translation_admin_security_live_homelinkDevices,
            )
    }
}
