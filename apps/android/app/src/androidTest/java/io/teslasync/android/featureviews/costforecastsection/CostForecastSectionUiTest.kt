package io.teslasync.android.featureviews.costforecastsection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
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
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [CostForecastSectionContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the per-panel friendly empty states
 * (the web `needData` / `needTrendData` messages), the populated charts (with their three-/one-swatch
 * legends and `Details` fallback tables), the per-panel data gating (a present-but-insufficient feed shows
 * the forecast empty state while still drawing the trend), and the stale/offline cached views. Asserts the
 * rendered i18n strings, the legend swatch accessibility labels, the retry affordance, the freshness chip's
 * TalkBack label, and the stale auto-refresh. The offline gate's `testReleaseUnitTest` covers the pure logic;
 * this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/cost-analysis/CostForecastSection.tsx).
 */
class CostForecastSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val forecastTitle = "Cost Forecast"
    private val trendTitle = "Cost per kWh Trend"
    private val needData = "Need at least 3 months of charging data for cost forecasting."
    private val needTrendData = "Need at least 2 months of charging data to show the cost per kWh trend."
    private val errorMessage = "Something went wrong on our end. Please try again."

    private fun setContent(
        state: UiState<CostForecastSectionData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CostForecastSectionContent(state = state, onRetry = onRetry, locale = Locale.US)
            }
        }
    }

    private fun data(historyMonths: Int = 3): CostForecastSectionData =
        CostForecastSectionData(
            historical =
                listOf(
                    CostForecastHistoricalPoint("Jan", 52.0, 0.130),
                    CostForecastHistoricalPoint("Feb", 48.5, 0.128),
                    CostForecastHistoricalPoint("Mar", 60.25, 0.142),
                ).take(historyMonths),
            forecast =
                listOf(
                    CostForecastProjectedPoint("Apr", 58.0, 50.0, 66.0),
                    CostForecastProjectedPoint("May", 61.0, 52.0, 70.0),
                ),
        )

    @Test
    fun loadingShowsBothPanelTitlesNotBlankPanels() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(forecastTitle).assertIsDisplayed()
        compose.onNodeWithText(trendTitle).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onAllNodesWithText(errorMessage).onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("Retry").onFirst().performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsBothFriendlyEmptyMessages() {
        setContent(UiState(UiPhase.Empty, data = CostForecastSectionData.EMPTY))
        compose.onNodeWithText(needData).assertIsDisplayed()
        compose.onNodeWithText(needTrendData).assertIsDisplayed()
    }

    @Test
    fun contentRendersTitlesLegendSwatchesAndDataTables() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText(forecastTitle).assertIsDisplayed()
        compose.onNodeWithText(trendTitle).assertIsDisplayed()
        compose.onNodeWithContentDescription("Actual Cost").assertExists()
        compose.onNodeWithContentDescription("95% Confidence").assertExists()
        compose.onNodeWithContentDescription("Projected Cost").assertExists()
        compose.onNodeWithContentDescription("\$/kWh").assertExists()
        compose.onAllNodesWithText("Details").onFirst().assertIsDisplayed()
    }

    @Test
    fun insufficientHistoryShowsForecastEmptyButStillRendersTrend() {
        setContent(UiState(UiPhase.Content, data = data(historyMonths = 2)))
        compose.onNodeWithText(needData).assertIsDisplayed()
        compose.onNodeWithContentDescription("\$/kWh").assertExists()
    }

    @Test
    fun offlineShowsCachedChartsWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(forecastTitle).assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = data(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText(trendTitle).assertIsDisplayed()
        assertTrue(refreshed)
    }
}
