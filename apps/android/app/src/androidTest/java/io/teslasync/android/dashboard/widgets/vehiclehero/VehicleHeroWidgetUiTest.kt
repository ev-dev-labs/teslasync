package io.teslasync.android.dashboard.widgets.vehiclehero

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.featureviews.vehiclehero.VehicleHeroData
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
 * On-device Compose UI + accessibility verification of [VehicleHeroWidgetContent] across every state the web
 * widget renders (loading skeleton, hard error + retry, the live charging hero folded into one TalkBack
 * phrase, the no-vehicle empty state, the asleep wake card, the stale/offline cached hero). Asserts the
 * rendered i18n strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest`
 * (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class VehicleHeroWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val milesFormatter =
        UnitFormatter(
            UnitPref(
                distance = DistanceUnitPref.MI,
                speed = SpeedUnitPref.MPH,
                temperature = TemperatureUnitPref.CELSIUS,
                pressure = PressureUnitPref.KPA,
                energy = EnergyUnitPref.KWH,
                duration = DurationUnitPref.HOURS,
                power = PowerUnitPref.KW,
            ),
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
            chargeRate = 12.5,
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
            state = if (isCharging) "charging" else "online",
            timeToFullCharge = 2.5,
            vehicleId = 5,
        )

    private fun setContent(
        uiState: UiState<VehicleHeroData>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleHeroWidgetContent(state = uiState, onRefresh = onRefresh, formatter = milesFormatter)
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
            uiState = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun chargingHeroFoldsMetricsIntoAccessiblePhrase() {
        setContent(
            UiState(
                UiPhase.Content,
                data = VehicleHeroData(vehicle(), state(isCharging = true), firmwareVersion = "2025.1.0"),
                fetchedAt = NOW,
            ),
        )
        // The hero body is folded into one TalkBack phrase carrying the name, status, and battery cue.
        compose.onNodeWithContentDescription("Battery 72%", substring = true).assertIsDisplayed()
    }

    @Test
    fun notChargingHeroShowsVehicleName() {
        setContent(
            UiState(
                UiPhase.Content,
                data = VehicleHeroData(vehicle(), state(isCharging = false), firmwareVersion = "2025.1.0"),
                fetchedAt = NOW,
            ),
        )
        compose.onNodeWithText("Garage Car").assertIsDisplayed()
        compose.onNodeWithContentDescription("Battery 72%", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoVehicleMessage() {
        setContent(UiState(UiPhase.Empty, data = VehicleHeroData(vehicle = null, state = null, firmwareVersion = "\u2014")))
        compose.onNodeWithText("No vehicle data").assertIsDisplayed()
    }

    @Test
    fun asleepStateShowsWakeCard() {
        setContent(
            UiState(
                UiPhase.Content,
                data = VehicleHeroData(vehicle(), state = null, firmwareVersion = "\u2014"),
                fetchedAt = NOW,
            ),
        )
        compose.onNodeWithText("Vehicle asleep", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Wake Up").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedHeroVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = VehicleHeroData(vehicle(), state(isCharging = false), firmwareVersion = "2025.1.0"),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Battery 72%", substring = true).assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
