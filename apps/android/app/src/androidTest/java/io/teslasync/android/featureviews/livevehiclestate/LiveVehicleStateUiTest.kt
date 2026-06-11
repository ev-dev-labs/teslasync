package io.teslasync.android.featureviews.livevehiclestate

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [LiveVehicleStateContent] across the branches the
 * web component renders (web/src/features/admin/components/security-access/LiveVehicleState.tsx): the live
 * grid with the "Live" indicator, the empty state (which hides the indicator), and the wide responsive
 * (5-column) layout. Every asserted string is resolved from the app's i18n resources so the test follows
 * the device locale rather than hard-coding English. The clock auto-advance is disabled so the "Live" dot's
 * infinite pulse cannot stall `waitForIdle`; the FadeIn entry is settled with an explicit advance. Runs
 * under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection.
 */
class LiveVehicleStateUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private fun populatedEvent() =
        SecurityEventLive(
            lightsHazardsActive = true,
            lightsHighBeams = false,
            lightsTurnSignal = JsonPrimitive("Left"),
            driverSeatOccupied = true,
            pairedPhoneKeyCount = 3,
            valetModeEnabled = false,
            serviceMode = false,
            speedLimitMode = JsonPrimitive(false),
            homelinkDeviceCount = 2,
            centerDisplay = JsonPrimitive("Standby"),
        )

    private fun setContent(
        display: LiveVehicleStateDisplay,
        width: Dp = PHONE_WIDTH,
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT)) {
                    LiveVehicleStateContent(display = display)
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    @Test
    fun dataShowsEverySignalLabelTheLiveIndicatorAndResolvedValues() {
        setContent(LiveVehicleStateProjection.project(populatedEvent()))

        // Every signal's accessible label is present (a11y label test).
        for (labelId in SIGNAL_LABEL_IDS) {
            compose.onNodeWithText(string(labelId)).assertIsDisplayed()
        }
        // The "Live" indicator renders when an event is present.
        compose.onNodeWithText(string(R.string.translation_admin_security_live_indicator)).assertIsDisplayed()
        // Distinct projected values render (passthrough strings + a stringified count).
        compose.onNodeWithText("Left").assertIsDisplayed()
        compose.onNodeWithText("Standby").assertIsDisplayed()
        compose.onNodeWithText("3").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDataMessageAndHidesTheLiveIndicator() {
        setContent(LiveVehicleStateProjection.project(latest = null))

        val noData = string(R.string.translation_admin_security_live_noData)
        // The empty message renders as text and as the panel's accessible description (a11y).
        compose.onNodeWithText(noData).assertIsDisplayed()
        compose.onNodeWithContentDescription(noData).assertIsDisplayed()
        // The "Live" indicator is withheld when no event is present.
        compose.onNodeWithText(string(R.string.translation_admin_security_live_indicator)).assertDoesNotExist()
    }

    @Test
    fun wideLayoutRendersEverySignalLabel() {
        setContent(LiveVehicleStateProjection.project(populatedEvent()), width = WIDE_WIDTH)

        for (labelId in SIGNAL_LABEL_IDS) {
            compose.onNodeWithText(string(labelId)).assertIsDisplayed()
        }
    }

    private companion object {
        val PHONE_WIDTH = 360.dp
        val WIDE_WIDTH = 1100.dp
        val HOST_HEIGHT = 1024.dp
        const val SETTLE_MS = 2_000L

        val SIGNAL_LABEL_IDS =
            listOf(
                R.string.translation_admin_security_live_hazards,
                R.string.translation_admin_security_live_highBeams,
                R.string.translation_admin_security_live_turnSignal,
                R.string.translation_admin_security_live_driverSeat,
                R.string.translation_admin_security_live_pairedKeys,
                R.string.translation_admin_security_live_valetMode,
                R.string.translation_admin_security_live_serviceMode,
                R.string.translation_admin_security_live_speedLimit,
                R.string.translation_admin_security_live_homelinkDevices,
                R.string.translation_admin_security_live_centerDisplay,
            )
    }
}
