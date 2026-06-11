package io.teslasync.android.dashboard.widgets.routeefficiency

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
 * On-device Compose UI + accessibility verification of [RouteEfficiencyWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, ranked route list, wide best/worst
 * breakdown, no-data empty, stale/offline cached). Asserts the rendered i18n strings, the efficiency-band
 * chips, and the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class RouteEfficiencyWidgetUiTest {
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

    private fun snapshot(): RouteEfficiencySnapshot =
        RouteEfficiencySnapshot(
            routes =
                listOf(
                    RouteSummaryRaw(
                        startLocation = "Home",
                        endLocation = "Work",
                        tripCount = 42,
                        avgEfficiencyWhKm = 150.0,
                        bestEfficiencyWhKm = 132.0,
                        worstEfficiencyWhKm = 171.0,
                    ),
                    RouteSummaryRaw(
                        startLocation = "Home",
                        endLocation = "Gym",
                        tripCount = 18,
                        avgEfficiencyWhKm = 360.0,
                        bestEfficiencyWhKm = 320.0,
                        worstEfficiencyWhKm = 410.0,
                    ),
                    RouteSummaryRaw(
                        startLocation = "Work",
                        endLocation = "Airport",
                        tripCount = 7,
                        avgEfficiencyWhKm = 420.0,
                        bestEfficiencyWhKm = 390.0,
                        worstEfficiencyWhKm = 455.0,
                    ),
                ),
        )

    private fun setContent(
        state: UiState<RouteEfficiencySnapshot>,
        size: RouteEfficiencySize = RouteEfficiencyRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RouteEfficiencyWidgetContent(
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
    fun contentShowsTitleRankedRoutesAndBadges() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Route Efficiency").assertIsDisplayed()
        // Row text lives under a merged (TalkBack-grouped) node, so query the unmerged tree.
        compose.onNodeWithText("Home", substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Excellent", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("241 Wh/mi", substring = true, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun rankedRowExposesAccessibilityPhrase() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        // The best (most efficient) route ranks first; its row folds rank + label + badge + value into
        // one TalkBack phrase.
        compose.onNodeWithContentDescription("Home \u2192 Work", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Excellent", substring = true).assertIsDisplayed()
    }

    @Test
    fun wideShowsBestWorstBreakdownInLabel() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW), size = RouteEfficiencySize(cols = 3, rows = 4))
        compose.onNodeWithText("best", substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("worst", substring = true, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoRouteDataMessage() {
        setContent(UiState(UiPhase.Empty, data = RouteEfficiencySnapshot(emptyList()), fetchedAt = NOW))
        compose.onNodeWithText("No route data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedRoutesVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Home", substring = true, useUnmergedTree = true).assertIsDisplayed()
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
