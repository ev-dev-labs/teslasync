package io.teslasync.android.dashboard.widgets.rangebar

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
 * On-device Compose UI + accessibility verification of [RangeBarWidgetContent] across every state the web
 * component renders (loading skeleton, hard error + retry, standard two-bar comparison with EPA variance,
 * compact rated-range hero, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the
 * folded TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) —
 * the offline gate's `testReleaseUnitTest` covers the logic; this covers the render + a11y.
 */
class RangeBarWidgetUiTest {
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
        ratedMeters: Double = RATED_250_MI,
        idealMeters: Double = IDEAL_260_MI,
    ): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = idealMeters,
            insideTemp = 0.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = ratedMeters,
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
        size: RangeBarSize = RangeBarRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangeBarWidgetContent(
                    state = state,
                    prefs = milesPrefs,
                    size = size,
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
    fun standardShowsBothBarsAndEpaVarianceViaAccessiblePhrase() {
        setContent(UiState(UiPhase.Content, data = envelope(state()), fetchedAt = NOW))
        // The two bars + EPA variance are folded into one TalkBack phrase carrying every converted value.
        compose.onNodeWithContentDescription("Rated Range 250 mi", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Ideal Range 260 mi", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("EPA variance +4.0%", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactShowsRatedHeroPhrase() {
        setContent(
            UiState(UiPhase.Content, data = envelope(state()), fetchedAt = NOW),
            size = RangeBarSize(cols = 1, rows = 1),
        )
        compose.onNodeWithContentDescription("250 mi rated", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoRangeDataMessage() {
        setContent(UiState(UiPhase.Empty, data = envelope(null), fetchedAt = NOW))
        compose.onNodeWithText("No range data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedBarsVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = envelope(state()),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Rated Range 250 mi", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = envelope(state()), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        const val RATED_250_MI = 402_336.0
        const val IDEAL_260_MI = 418_429.44
    }
}
