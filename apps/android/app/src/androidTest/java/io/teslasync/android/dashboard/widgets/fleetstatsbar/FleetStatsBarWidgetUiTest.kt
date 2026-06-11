package io.teslasync.android.dashboard.widgets.fleetstatsbar

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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [FleetStatsBarWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, four-stat content + freshness header,
 * compact stacked content, no-data empty, stale/offline cached). Asserts the rendered i18n strings and
 * the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) —
 * the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class FleetStatsBarWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = FleetStatsBarDisplayPrefs(DistanceUnitPref.KM)
    private val standardSize = FleetStatsBarRegistration.defaultSize
    private val compactSize = FleetStatsBarSize(cols = 4, rows = 1)

    private fun fleetData(
        vehicleCount: Int = 3,
        onlineCount: Int = 1,
        distanceSI: Double = 5000.0,
        energyKwh: Double = 42.0,
    ): FleetStatsBarData =
        FleetStatsBarData(
            vehicleCount = vehicleCount,
            onlineCount = onlineCount,
            totalDistanceSI = distanceSI,
            totalEnergyKwh = energyKwh,
            hasData = true,
        )

    private fun setContent(
        state: UiState<FleetStatsBarData>,
        size: FleetStatsBarSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FleetStatsBarWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
                    onRefresh = onRefresh,
                    locale = Locale.US,
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
    fun standardContentShowsTitleAndFourStats() {
        setContent(UiState(UiPhase.Content, data = fleetData(), fetchedAt = NOW))
        compose.onNodeWithText("Fleet Stats").assertIsDisplayed()
        compose.onNodeWithText("Vehicles").assertIsDisplayed()
        compose.onNodeWithText("Online Now").assertIsDisplayed()
        compose.onNodeWithText("Distance (30d)").assertIsDisplayed()
        compose.onNodeWithText("Energy (30d)").assertIsDisplayed()
        // 5000 m → 5.0 km; energy formatted with the literal kWh suffix.
        compose.onNodeWithText("5.0").assertIsDisplayed()
        compose.onNodeWithText("km").assertIsDisplayed()
        compose.onNodeWithText("42.0").assertIsDisplayed()
        compose.onNodeWithText("kWh").assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = fleetData(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentStacksAllFourStats() {
        setContent(
            state = UiState(UiPhase.Content, data = fleetData(), fetchedAt = NOW),
            size = compactSize,
        )
        compose.onNodeWithText("Vehicles").assertIsDisplayed()
        compose.onNodeWithText("Online Now").assertIsDisplayed()
        compose.onNodeWithText("Distance (30d)").assertIsDisplayed()
        compose.onNodeWithText("Energy (30d)").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = FleetStatsBarData.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("No fleet data available").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedStatsVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = fleetData(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Distance (30d)").assertIsDisplayed()
        compose.onNodeWithText("5.0").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
