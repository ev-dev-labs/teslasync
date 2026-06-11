package io.teslasync.android.dashboard.widgets.odometercounter

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
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
 * On-device Compose UI + accessibility verification of [OdometerCounterWidgetContent] across every state the
 * web component renders (loading skeleton, hard error + retry, expanded "Total Odometer" count-up, wide
 * breakdown grid, compact number-only, no-data empty, stale/offline cached). Asserts the rendered i18n
 * strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class OdometerCounterWidgetUiTest {
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

    // 402336 m = 250 mi; total_distance_km field 80467.2 → 50 mi (passed verbatim, per the model's PARITY NOTE).
    private fun snapshot(
        odometerMeters: Double? = 402_336.0,
        totalDistanceKm: Double? = 80_467.2,
    ): OdometerSnapshot = OdometerSnapshot(odometerMeters, totalDistanceKm)

    private fun setContent(
        state: UiState<OdometerSnapshot>,
        size: OdometerCounterSize = OdometerCounterRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OdometerCounterWidgetContent(
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
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun expandedShowsTotalOdometerViaAccessiblePhrase() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        // The primary reading folds its label + converted value into one TalkBack phrase.
        compose.onNodeWithContentDescription("Total Odometer", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("250 mi", substring = true).assertIsDisplayed()
    }

    @Test
    fun wideShowsTotalDrivenAndUnitBreakdown() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW), size = OdometerCounterSize(cols = 2, rows = 2))
        compose.onNodeWithText("Total Driven").assertIsDisplayed()
        compose.onNodeWithText("50 mi").assertIsDisplayed()
        compose.onNodeWithText("Unit").assertIsDisplayed()
    }

    @Test
    fun compactShowsOdometerAndUnit() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW), size = OdometerCounterSize(cols = 1, rows = 1))
        compose.onNodeWithContentDescription("250 mi", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoOdometerDataMessage() {
        setContent(UiState(UiPhase.Empty, data = snapshot(odometerMeters = null, totalDistanceKm = null), fetchedAt = NOW))
        compose.onNodeWithText("No odometer data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached value stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("250 mi", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
