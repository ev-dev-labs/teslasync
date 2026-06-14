package io.teslasync.android.dashboard.widgets.weatheratcar

import androidx.compose.ui.test.assertDoesNotExist
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
 * On-device Compose UI + accessibility verification of [WeatherAtCarWidgetContent] across every state the
 * web component renders (loading skeleton, the full reading body with the title + temperature + label +
 * coordinates, the compact reading body, no-data empty, hard error with refresh-retry, stale/offline
 * cached). Asserts the rendered i18n strings and the folded TalkBack content description are present, and
 * that the refresh control fires. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the projection/state logic; this covers the render + a11y.
 */
class WeatherAtCarWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val celsiusPrefs =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    private fun state(outsideTemp: Double = 14.0): VehicleState =
        VehicleState(
            batteryLevel = 68,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 37.42,
            longitude = -122.08,
            odometer = 0.0,
            outsideTemp = outsideTemp,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 5,
        )

    private fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

    private fun setContent(
        state: UiState<VehicleStateEnvelope>,
        compact: Boolean = false,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WeatherAtCarWidgetContent(
                    state = state,
                    prefs = celsiusPrefs,
                    compact = compact,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun contentState(): UiState<VehicleStateEnvelope> = UiState(phase = UiPhase.Content, data = envelope(state()), fetchedAt = NOW)

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState.loading())
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
        compose.onNodeWithText("No weather data").assertDoesNotExist()
    }

    @Test
    fun fullContentShowsTitleTemperatureAndLabel() {
        setContent(contentState())
        compose.onNodeWithText("Weather at Car").assertIsDisplayed()
        compose.onNodeWithText("14\u00B0C").assertIsDisplayed()
        compose.onNodeWithText("Outside Temperature").assertIsDisplayed()
    }

    @Test
    fun fullContentFoldsReadingIntoAccessiblePhrase() {
        setContent(contentState())
        compose.onNodeWithContentDescription("Outside Temperature 14\u00B0C", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(contentState())
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsTemperatureWithoutTitle() {
        setContent(contentState(), compact = true)
        compose.onNodeWithText("14\u00B0C").assertIsDisplayed()
        compose.onNodeWithText("Weather at Car").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoWeatherDataMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = envelope(null), fetchedAt = NOW))
        compose.onNodeWithText("No weather data").assertIsDisplayed()
    }

    @Test
    fun errorShowsEmptyBodyWithRefreshRetry() {
        var refreshed = false
        setContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { refreshed = true },
        )
        compose.onNodeWithText("No weather data").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedReadingVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = envelope(state()),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("14\u00B0C").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
