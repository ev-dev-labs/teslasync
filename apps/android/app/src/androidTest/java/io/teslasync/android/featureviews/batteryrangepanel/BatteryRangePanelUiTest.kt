package io.teslasync.android.featureviews.batteryrangepanel

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.VehicleState
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [BatteryRangePanelContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state, the
 * populated panel (battery gauge + the three metric cards with the charging / not-charging and "Full in"
 * conditionals), and the stale/offline cached view. Asserts the rendered i18n strings and the TalkBack content
 * descriptions (the accessible loading label, the gauge's combined description, the offline freshness chip).
 * The offline gate's `testReleaseUnitTest` covers the pure projection; this covers render + a11y. Locale.US
 * fixes the numeric formatting so the string assertions are deterministic. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx).
 */
class BatteryRangePanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun vehicleState(
        batteryLevel: Long = 72L,
        isCharging: Boolean = false,
        chargeRate: Double = 0.0,
        timeToFullCharge: Double = 0.0,
        ratedRange: Double = 386_000.0,
        idealRange: Double = 402_000.0,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = chargeRate,
            chargerPower = 0.0,
            idealRange = idealRange,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 37.4,
            longitude = -122.1,
            odometer = 24_140_160.0,
            outsideTemp = 14.0,
            power = 0.0,
            ratedRange = ratedRange,
            sentryMode = false,
            softwareVersion = "2024.20.1",
            speed = 0.0,
            state = "online",
            timeToFullCharge = timeToFullCharge,
            vehicleId = 1L,
        )

    private fun setContent(
        state: UiState<VehicleState>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryRangePanelContent(state = state, onRetry = onRetry, locale = Locale.US)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun chargingContentRendersGaugeCardsRateAndFullInSubtitle() {
        setContent(
            UiState(
                UiPhase.Content,
                data = vehicleState(batteryLevel = 72L, isCharging = true, chargeRate = 48_000.0, timeToFullCharge = 2.5),
            ),
        )
        // The three metric card labels (a11y label test) …
        compose.onNodeWithText("Rated Range").assertIsDisplayed()
        compose.onNodeWithText("Ideal Range").assertIsDisplayed()
        compose.onNodeWithText("Charging").assertIsDisplayed()
        // … their formatted values …
        compose.onNodeWithText("386 km").assertExists()
        compose.onNodeWithText("402 km").assertExists()
        compose.onNodeWithText("48.0 km/h").assertExists()
        // … the "Full in" charging subtitle (web `is_charging && time_to_full_charge > 0`) …
        compose.onNodeWithText("Full in 2.5h").assertExists()
        // … and the gauge's combined TalkBack description (label + value).
        compose.onNodeWithContentDescription("Battery", substring = true).assertExists()
    }

    @Test
    fun notChargingContentShowsTheNotChargingLabelAndNoSubtitle() {
        setContent(UiState(UiPhase.Content, data = vehicleState(batteryLevel = 18L, isCharging = false)))
        compose.onNodeWithText("Not Charging").assertExists()
        compose.onNodeWithText("Full in", substring = true).assertDoesNotExist()
    }

    @Test
    fun offlineShowsCachedPanelWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = vehicleState(batteryLevel = 54L, isCharging = false),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // The cached panel still renders …
        compose.onNodeWithText("Rated Range").assertIsDisplayed()
        // … with the honest offline freshness chip.
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = vehicleState(batteryLevel = 54L, isCharging = false),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Rated Range").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
