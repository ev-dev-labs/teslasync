package io.teslasync.android.featureviews.livetelemetrypanels

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
 * Instrumented Compose UI + accessibility verification of [LiveTelemetryPanelsContent] across the branches the
 * web component renders (web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx): the
 * populated grid with every panel's rows and the Vehicle State "Live" chip, and the empty state where every
 * panel still renders its header plus a friendly empty caption (no panel is ever hidden). Every asserted
 * string is resolved from the app's i18n resources so the test follows the device locale rather than
 * hard-coding English. The content carries no animation, so no clock control is needed; a vertical scroll
 * host lets the assertions reach every panel regardless of viewport height. The offline
 * `testReleaseUnitTest` gate covers the pure projection.
 */
class LiveTelemetryPanelsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private val populated =
        LiveTelemetryPanelsData(
            motor = MotorSnapshotLive(shiftState = "D", powerKw = 142.0, motorRpmFront = 3200.0, inverterTempC = 48.0, regenKw = 22.0),
            climate =
                ClimateSnapshotLive(
                    insideTempC = 21.0,
                    outsideTempC = 8.0,
                    hvacState = "On",
                    defrostMode = "Front",
                    isClimateOn = true,
                    fanStatus = 4.0,
                ),
            security =
                SecurityEventLive(doorsOpen = "Closed", windowsOpen = "Closed", locked = true, sentryMode = true, userPresent = true),
            vehicleState =
                VehicleStateLive(
                    lightsTurnSignal = "Left",
                    driverSeatOccupied = true,
                    pairedKeyCount = JsonPrimitive(3),
                    centerDisplay = JsonPrimitive("Drive"),
                ),
            sseConnected = true,
            tire = TirePressureLive(frontLeft = 290_000.0, frontRight = 285_000.0, rearLeft = 295_000.0, rearRight = 300_000.0),
            charging =
                ChargingTelemetryLive(
                    batteryLevel = 72.0,
                    chargingState = "Charging",
                    chargerVoltage = 240.0,
                    chargerActualCurrent = 32.0,
                    chargerPowerW = 11_000.0,
                    chargeEnergyAddedWh = 18_400.0,
                    rangeAddedMetersPerHour = 48_280.0,
                ),
            media =
                MediaSnapshotLive(
                    nowPlayingTitle = "Starlight",
                    nowPlayingArtist = "Muse",
                    playbackStatus = "Playing",
                    playbackSource = "Spotify",
                ),
            location =
                LocationSnapshotLive(
                    destinationName = "Supercharger",
                    metersToArrival = 12_350.0,
                    minutesToArrival = 9.0,
                    locatedAtWork = true,
                ),
            remoteStartEnabled = true,
        )

    private fun setContent(
        data: LiveTelemetryPanelsData,
        width: Dp = PHONE_WIDTH,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT).verticalScroll(rememberScrollState())) {
                    LiveTelemetryPanelsContent(LiveTelemetryPanelsProjection.project(data, UnitFormatter.default()))
                }
            }
        }
    }

    @Test
    fun dataStateRendersEveryPanelTitleTheLiveChipAndResolvedValues() {
        setContent(populated)

        // The section header renders (a11y label test) and is on screen.
        compose.onNodeWithText(string(R.string.translation_common_liveTelemetry)).assertIsDisplayed()
        // Every panel header label is present (a11y label coverage).
        for (titleId in PANEL_TITLE_IDS) {
            compose.onNodeWithText(string(titleId)).assertExists()
        }
        // The Vehicle State "Live" chip renders when the stream is connected.
        compose.onNodeWithText(string(R.string.translation_admin_security_live_indicator)).assertExists()
        // A representative row label from a deep panel resolves through i18n.
        compose.onNodeWithText(string(R.string.translation_telemetry_chargerVoltage)).assertExists()
        compose.onNodeWithText(string(R.string.translation_telemetry_shiftState)).assertExists()
        // Distinct projected/passthrough values render.
        compose.onNodeWithText("142.00 kW").assertExists()
        compose.onNodeWithText("Starlight").assertExists()
        compose.onNodeWithText("Supercharger").assertExists()
    }

    @Test
    fun emptyStateKeepsEveryPanelHeaderAndShowsItsEmptyCaption() {
        setContent(LiveTelemetryPanelsData())

        // No panel is hidden — every header still renders.
        for (titleId in PANEL_TITLE_IDS) {
            compose.onNodeWithText(string(titleId)).assertExists()
        }
        // Each data-bearing panel shows its empty caption instead of rows.
        for (captionId in EMPTY_CAPTION_IDS) {
            compose.onNodeWithText(string(captionId)).assertExists()
        }
        // The Vehicle State panel always renders its rows even with no data (a11y label present).
        compose.onNodeWithText(string(R.string.translation_admin_security_live_highBeams)).assertExists()
        // The "Live" chip is withheld when the stream is not connected.
        compose.onNodeWithText(string(R.string.translation_admin_security_live_indicator)).assertDoesNotExist()
    }

    @Test
    fun wideLayoutRendersEveryPanelTitle() {
        setContent(populated, width = WIDE_WIDTH)

        for (titleId in PANEL_TITLE_IDS) {
            compose.onNodeWithText(string(titleId)).assertExists()
        }
    }

    private companion object {
        val PHONE_WIDTH = 360.dp
        val WIDE_WIDTH = 1100.dp
        val HOST_HEIGHT = 1024.dp

        val PANEL_TITLE_IDS =
            listOf(
                R.string.translation_common_powertrain,
                R.string.translation_common_climate,
                R.string.translation_common_security,
                R.string.translation_telemetry_vehicleState,
                R.string.translation_common_tirePressure,
                R.string.translation_telemetry_energyCharging,
                R.string.translation_telemetry_mediaNav,
            )

        val EMPTY_CAPTION_IDS =
            listOf(
                R.string.translation_telemetry_noMotorData,
                R.string.translation_telemetry_noClimateData,
                R.string.translation_telemetry_noSecurityData,
                R.string.translation_vehicles_detail_noTireData,
                R.string.translation_telemetry_noChargingTelemetry,
                R.string.translation_telemetry_noMediaData,
                R.string.translation_telemetry_noLocationData,
            )
    }
}
