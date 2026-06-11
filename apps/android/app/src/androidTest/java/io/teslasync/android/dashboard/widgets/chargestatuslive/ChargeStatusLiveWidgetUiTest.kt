package io.teslasync.android.dashboard.widgets.chargestatuslive

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
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of [ChargeStatusLiveWidgetContent] across every state
 * the web component renders (loading skeleton, empty "No charge data", hard error + retry, full charging
 * view with badge/power/cells, full idle view, compact hero, stale/offline cached). Asserts the rendered
 * i18n strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the logic, this covers the render.
 */
class ChargeStatusLiveWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val units: UnitPref = UnitFormatter.default().prefs

    @Suppress("LongParameterList")
    private fun vehicleState(
        batteryLevel: Long = 82,
        isCharging: Boolean = true,
        chargerPower: Double = 11.0,
        chargeRate: Double = 50_000.0,
        timeToFullCharge: Double = 1.5,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = chargeRate,
            chargerPower = chargerPower,
            idealRange = 300_000.0,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 10.0,
            power = 0.0,
            ratedRange = 300_000.0,
            sentryMode = false,
            softwareVersion = "2026.4",
            speed = 0.0,
            state = "charging",
            timeToFullCharge = timeToFullCharge,
            vehicleId = 1L,
        )

    private fun session(totalEnergyAddedWh: Double? = 12_345.0): ChargingSession =
        ChargingSession(
            id = 1L,
            startedAt = Instant.fromEpochMilliseconds(0L),
            vehicleId = 1L,
            totalEnergyAddedWh = totalEnergyAddedWh,
        )

    private fun setContent(
        state: UiState<ChargeStatusLiveSnapshot>,
        size: ChargeStatusLiveSize = ChargeStatusLiveRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargeStatusLiveWidgetContent(
                    state = state,
                    size = size,
                    units = units,
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
    fun emptyShowsNoChargeDataMessage() {
        setContent(UiState(UiPhase.Empty, data = ChargeStatusLiveSnapshot(state = null, latestSession = null), fetchedAt = 1L))
        compose.onNodeWithText("No charge data").assertIsDisplayed()
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
    fun fullChargingShowsBadgePowerAndCells() {
        setContent(
            UiState(
                UiPhase.Content,
                data = ChargeStatusLiveSnapshot(vehicleState(), session()),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Charging").assertIsDisplayed()
        // Power readout exposes a folded TalkBack phrase even while the count-up animates.
        compose.onNodeWithContentDescription("11.0 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Time Left 1h 30m").assertIsDisplayed()
        compose.onNodeWithContentDescription("Added 12.3 kWh").assertIsDisplayed()
        compose.onNodeWithContentDescription("Battery 82%").assertIsDisplayed()
    }

    @Test
    fun fullIdleShowsNotChargingAndLastSession() {
        setContent(
            UiState(
                UiPhase.Content,
                data = ChargeStatusLiveSnapshot(vehicleState(isCharging = false), session()),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Not Charging").assertIsDisplayed()
        compose.onNodeWithText("Last Session").assertIsDisplayed()
        compose.onNodeWithText("+12.3 kWh").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = ChargeStatusLiveSnapshot(vehicleState(), session()), fetchedAt = 1L),
            size = ChargeStatusLiveSize(cols = 1, rows = 1),
        )
        compose.onNodeWithContentDescription("11.0 kW, 82%").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = ChargeStatusLiveSnapshot(vehicleState(), session()),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached charging metrics stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("11.0 kW").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = ChargeStatusLiveSnapshot(vehicleState(), session()), fetchedAt = 1L))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
