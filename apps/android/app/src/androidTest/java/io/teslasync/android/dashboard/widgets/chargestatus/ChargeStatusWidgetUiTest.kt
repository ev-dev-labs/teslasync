package io.teslasync.android.dashboard.widgets.chargestatus

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
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ChargeStatusWidgetContent] across every state the
 * web component renders (loading skeleton, hard error + retry, active-charge grid, parked "Not Charging"
 * hero, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the logic; this covers the render + a11y.
 */
class ChargeStatusWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val milesPrefs =
        UnitPref(
            distance = DistanceUnitPref.MI,
            speed = SpeedUnitPref.MPH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    private fun state(
        isCharging: Boolean,
        batteryLevel: Long = 72,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 80_467.2,
            chargerPower = 11.0,
            idealRange = 0.0,
            insideTemp = 0.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = 402_336.0,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 1.5,
            vehicleId = 5,
        )

    private fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

    private fun setContent(
        state: UiState<VehicleStateEnvelope>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargeStatusWidgetContent(
                    state = state,
                    prefs = milesPrefs,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun chargingShowsMetricGridViaAccessiblePhrase() {
        setContent(UiState(UiPhase.Content, data = envelope(state(isCharging = true)), fetchedAt = NOW))
        // The 2×2 grid is folded into one TalkBack phrase carrying every converted value.
        compose.onNodeWithContentDescription("Power 11.00 kW", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Rate 50 mi/h", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Battery 72%", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Time to Full 1.5h", substring = true).assertIsDisplayed()
    }

    @Test
    fun notChargingShowsBatteryAndRangeSummary() {
        setContent(UiState(UiPhase.Content, data = envelope(state(isCharging = false)), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Not Charging", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("250 mi", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoChargeDataMessage() {
        setContent(UiState(UiPhase.Empty, data = envelope(null), fetchedAt = NOW))
        compose.onNodeWithText("No charge data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedChargingContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = envelope(state(isCharging = true)),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Battery 72%", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = envelope(state(isCharging = true)), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
