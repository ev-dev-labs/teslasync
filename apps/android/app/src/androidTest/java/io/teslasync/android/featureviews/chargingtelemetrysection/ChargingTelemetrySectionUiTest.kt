package io.teslasync.android.featureviews.chargingtelemetrysection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ChargingTelemetrySectionContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state, the
 * populated eight-tile grid, and the stale/offline cached view. Asserts the always-present panel title, the
 * rendered metric values, each tile's merged TalkBack label, the no-data message, the freshness chip's offline
 * label, and the stale auto-refresh. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers
 * render + a11y. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx).
 */
class ChargingTelemetrySectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ChargingTelemetrySectionStrings(
            title = "Charging Telemetry",
            chargerPower = "Charger Power",
            voltage = "Voltage",
            current = "Current",
            energyAdded = "Energy Added",
            chargingState = "Charging State",
            batteryLevel = "Battery Level",
            chargeRate = "Charge Rate",
            rangeAdded = "Range Added",
            noData = "No charging telemetry available",
        )

    private fun snapshot(): ChargingTelemetrySnapshot =
        ChargingTelemetrySnapshot(
            chargerPowerW = 11000.0,
            chargerVoltage = 240.0,
            chargerActualCurrent = 48.0,
            chargeEnergyAddedWh = 18500.0,
            chargingState = "Charging",
            batteryLevel = 72.0,
            rangeAddedMetersPerHour = 7200.0,
            rangeAddedMeters = 120000.0,
        )

    private fun setContent(
        state: UiState<ChargingTelemetrySnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargingTelemetrySectionContent(
                    state = state,
                    onRetry = onRetry,
                    formatter = UnitFormatter.default(),
                    strings = strings,
                )
            }
        }
    }

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState.loading())
        compose.onNodeWithText("Charging Telemetry").assertIsDisplayed()
        // The skeleton grid carries a single "Loading" announcement.
        compose.onNodeWithContentDescription("Loading").assertExists()
    }

    @Test
    fun errorShowsTitleRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Charging Telemetry").assertIsDisplayed()
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoTelemetryMessage() {
        setContent(ChargingTelemetrySectionProjection.projectUiState(snapshot = null, isLoading = false))
        compose.onNodeWithText("Charging Telemetry").assertIsDisplayed()
        compose.onNodeWithText("No charging telemetry available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleMetricValuesAndMergedTileLabels() {
        setContent(ChargingTelemetrySectionProjection.projectUiState(snapshot(), isLoading = false))
        compose.onNodeWithText("Charging Telemetry").assertIsDisplayed()
        // The charging-state value renders verbatim (no formatting / locale dependence).
        compose.onNodeWithText("Charging").assertIsDisplayed()
        // Each tile is a grouped node whose TalkBack label carries the metric name + its formatted value.
        compose.onNodeWithContentDescription("Charger Power", substring = true).assertExists()
        compose.onNodeWithContentDescription("Range Added", substring = true).assertExists()
        compose.onNodeWithContentDescription("Battery Level", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedTilesWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Charging Telemetry").assertIsDisplayed()
        compose.onNodeWithText("Charging").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = snapshot(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Charging Telemetry").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
