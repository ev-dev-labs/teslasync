package io.teslasync.android.featureviews.overviewvehiclecomparison

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
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
 * On-device Compose UI + accessibility verification of [OverviewVehicleComparisonContent] across every state
 * the surface renders: the loading skeleton chrome, the hard-error retry surface, the no-data per-panel empty
 * states, the populated four panels with their legends + accessible chart descriptions, and the
 * stale/offline cached views. Asserts the rendered i18n strings (from the real catalog) and the TalkBack
 * content descriptions (the always-visible titles, the legend swatch labels, the donut/radar chart summaries,
 * the freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render +
 * a11y. Mirrors the web spec (web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx).
 */
class OverviewVehicleComparisonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<VehicleComparison>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OverviewVehicleComparisonContent(
                    state = state,
                    onRetry = onRetry,
                    distanceUnit = DistanceUnitPref.KM,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun vehicles(): List<VehicleComparison> =
        listOf(
            VehicleComparison(1, "Model 3", distanceKm = 1840.0, energyKwh = 280.0, efficiencyWhKm = 152.0, drives = 96.0),
            VehicleComparison(2, "Model Y", distanceKm = 1220.0, energyKwh = 215.0, efficiencyWhKm = 176.0, drives = 64.0),
        )

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
    fun emptyShowsEveryPanelTitleAndItsEmptyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Fleet Usage").assertIsDisplayed()
        compose.onNodeWithText("Efficiency Leaderboard").assertIsDisplayed()
        compose.onNodeWithText("Vehicle Comparison").assertIsDisplayed()
        compose.onNodeWithText("Energy & Activity").assertIsDisplayed()
        // "No vehicle data" appears for both the donut and the bar panels.
        compose.onAllNodesWithText("No vehicle data").onFirst().assertIsDisplayed()
        compose.onNodeWithText("No efficiency data").assertIsDisplayed()
        compose.onNodeWithText("Need 2+ vehicles for comparison").assertIsDisplayed()
    }

    @Test
    fun contentRendersPanelsLegendsAndAccessibleCharts() {
        setContent(UiState(UiPhase.Content, data = vehicles()))
        compose.onNodeWithText("Fleet Usage").assertIsDisplayed()
        compose.onNodeWithText("Energy & Activity").assertIsDisplayed()
        // The bar legend exposes the two series as accessible labels.
        compose.onNodeWithContentDescription("Energy (kWh)").assertExists()
        // The donut + radar canvases carry an accessible summary (web hover tooltip parity).
        compose.onNodeWithContentDescription("Fleet Usage:", substring = true).assertExists()
        compose.onNodeWithContentDescription("Vehicle Comparison:", substring = true).assertExists()
        // The leaderboard ranks each vehicle.
        compose.onAllNodesWithText("#1 Model 3").onFirst().assertExists()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = vehicles(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Fleet Usage").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = vehicles(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Vehicle Comparison").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
