package io.teslasync.android.featureviews.monthlycostchart

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
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [MonthlyCostChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * area chart with its accessible description + fallback data table, and the stale/offline cached views.
 * Asserts the rendered i18n strings (the always-visible title, the "Not enough data" empty message, the
 * "Retry" affordance, the "Details" table) and the TalkBack content descriptions (the chart aria
 * description, the offline freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic;
 * this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx).
 */
class MonthlyCostChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<MonthlyCostPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MonthlyCostChartContent(
                    state = state,
                    onRetry = onRetry,
                    currency = MonthlyCostCurrencyPrefs.DEFAULT,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun points(): List<MonthlyCostPoint> =
        listOf(
            MonthlyCostPoint(month = "2024-01", cost = 42.0),
            MonthlyCostPoint(month = "2024-02", cost = 58.5),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Monthly Cost Trend").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Monthly Cost Trend").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNotEnoughDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Monthly Cost Trend").assertIsDisplayed()
        compose.onNodeWithText("Not enough data").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndDataTable() {
        setContent(UiState(UiPhase.Content, data = points()))
        compose.onNodeWithText("Monthly Cost Trend").assertIsDisplayed()
        // The chart canvas carries a TalkBack description so the opaque plot is not a silent surface.
        compose.onNodeWithContentDescription("Monthly charging cost trend area chart").assertIsDisplayed()
        // The accessible fallback data table is present (its expander label).
        compose.onNodeWithText("Details").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = points(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Monthly Cost Trend").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = points(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Monthly Cost Trend").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
