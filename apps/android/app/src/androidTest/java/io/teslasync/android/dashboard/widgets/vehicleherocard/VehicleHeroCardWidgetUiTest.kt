package io.teslasync.android.dashboard.widgets.vehicleherocard

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
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
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of [VehicleHeroCardContent] across every state the
 * web component renders (loading skeleton, hard error + retry, the full hero card folded into one
 * TalkBack phrase, the charge banner, the no-vehicle empty state, the stale/offline cached card). Asserts
 * the rendered i18n strings and the TalkBack content descriptions are present. Runs under
 * `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic;
 * this covers the render + a11y.
 */
class VehicleHeroCardWidgetUiTest {
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

    private fun vehicle(): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = "Garage Car",
            enrolledAt = Instant.fromEpochSeconds(0),
            id = 5,
            teslaId = 5,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = "VIN5",
            model = "Model 3",
            trimLevel = "Long Range",
        )

    private fun state(isCharging: Boolean): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 0.0,
            chargerPower = 11.0,
            idealRange = 402_336.0,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 9.0,
            power = 0.0,
            ratedRange = 402_336.0,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 5,
        )

    private fun setContent(
        uiState: UiState<VehicleHeroCardData>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleHeroCardContent(state = uiState, prefs = milesPrefs, onRefresh = onRefresh)
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
            uiState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun chargingCardFoldsMetricsIntoAccessiblePhrase() {
        setContent(
            UiState(UiPhase.Content, data = VehicleHeroCardData(vehicle(), state(isCharging = true)), fetchedAt = NOW),
        )
        // The hero card is folded into one TalkBack phrase carrying every converted value.
        compose.onNodeWithContentDescription("Battery 72%", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Range 250 mi", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Cabin 21\u00B0C", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Charging 11.0 kW", substring = true).assertIsDisplayed()
    }

    @Test
    fun notChargingCardShowsStatusAndRange() {
        setContent(
            UiState(UiPhase.Content, data = VehicleHeroCardData(vehicle(), state(isCharging = false)), fetchedAt = NOW),
        )
        compose.onNodeWithContentDescription("online", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Range 250 mi", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoVehicleMessage() {
        setContent(UiState(UiPhase.Empty, data = VehicleHeroCardData(vehicle = null, state = null), fetchedAt = NOW))
        compose.onNodeWithText("No vehicle data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedCardVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = VehicleHeroCardData(vehicle(), state(isCharging = false)),
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
        setContent(
            UiState(UiPhase.Content, data = VehicleHeroCardData(vehicle(), state(isCharging = true)), fetchedAt = NOW),
        )
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
