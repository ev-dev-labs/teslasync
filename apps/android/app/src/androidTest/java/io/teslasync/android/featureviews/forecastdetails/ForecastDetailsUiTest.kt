package io.teslasync.android.featureviews.forecastdetails

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ForecastDetailsContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the data-resolved-but-empty grid (each
 * panel's own friendly empty state), the populated grid (the three panel titles, the donut, the savings
 * count-up, and an insight), and the stale/offline cached view. Asserts the rendered i18n strings and the
 * TalkBack content descriptions (the accessible loading label, the combined donut breakdown, the settled
 * savings amount, the offline freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic;
 * this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/cost-analysis/ForecastDetails.tsx).
 */
class ForecastDetailsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<ForecastData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ForecastDetailsContent(state = state, onRetry = onRetry)
            }
        }
    }

    private fun populated(): ForecastData =
        ForecastData(
            breakdown =
                CostBreakdown(
                    home = ChargerCategory(pct = 70.0, avgCostPerKwh = 0.13),
                    supercharger = ChargerCategory(pct = 30.0, avgCostPerKwh = 0.42),
                ),
            gasComparison =
                GasComparison(
                    avgKmPerMonth = 1_540.0,
                    gasCostPerMonth = 188.0,
                    evCostPerMonth = 64.0,
                    monthlySavings = 124.0,
                    annualSavings = 1_488.0,
                    lifetimeSavings = 7_440.0,
                ),
            insights = listOf("Charge at home overnight."),
        )

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankGrid() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Can't reach server").assertExists()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsEveryPanelsFriendlyEmptyState() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("Breakdown will appear once charging data is available.").assertExists()
        compose.onNodeWithText("Savings data will appear once driving history is available.").assertExists()
        compose.onNodeWithText("Insights will appear as more data is collected.").assertExists()
    }

    @Test
    fun contentRendersEveryPanelTheDonutAndAnInsight() {
        setContent(UiState(UiPhase.Content, data = populated()))
        compose.onNodeWithText("Charging Breakdown").assertExists()
        compose.onNodeWithText("Gas vs EV Savings").assertExists()
        compose.onNodeWithText("Insights").assertExists()
        // The donut exposes one combined breakdown description instead of unreadable arcs.
        compose.onNodeWithContentDescription("Home 70%, Supercharger 30%").assertExists()
        // The count-up exposes its settled, currency-prefixed value to TalkBack.
        compose.onNodeWithContentDescription("\$124").assertExists()
        compose.onNodeWithText("Charge at home overnight.").assertExists()
    }

    @Test
    fun offlineShowsCachedGridWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = populated(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Gas vs EV Savings").assertExists()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = populated(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Charging Breakdown").assertExists()
        assertTrue(refreshed)
    }
}
