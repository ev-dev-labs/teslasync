package io.teslasync.android.featureviews.yearlytrendchart

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
 * On-device Compose UI + accessibility verification of [YearlyTrendChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * composed chart (with its accessible chart description, `dataColumns` table, axis-title captions, and
 * three-swatch legend), and the stale/offline cached views. Asserts the rendered i18n strings, the chart's
 * accessible description (web `ariaLabel`), the legend swatch labels, the axis titles, and the freshness
 * chip's TalkBack label. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render +
 * a11y. Mirrors the web spec (web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx).
 */
class YearlyTrendChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<YearlyTrendPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                YearlyTrendChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun points(): List<YearlyTrendPoint> =
        listOf(
            YearlyTrendPoint(year = "2023", avg10to80 = 42.5, avg20to80 = 31.2, count = 84),
            YearlyTrendPoint(year = "2024", avg10to80 = 38.0, avg20to80 = 28.5, count = 132),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Yearly Charging Speed Trend").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Yearly Charging Speed Trend").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionLegendAndAxisTitles() {
        setContent(UiState(UiPhase.Content, data = points()))
        compose.onNodeWithText("Yearly Charging Speed Trend").assertIsDisplayed()
        compose
            .onNodeWithContentDescription("Yearly average charge-time and session-count composed chart")
            .assertExists()
        compose.onNodeWithText("Details").assertIsDisplayed()
        compose.onNodeWithText("Minutes").assertIsDisplayed()
        compose.onNodeWithText("Sessions").assertIsDisplayed()
        compose.onNodeWithContentDescription("10\u219280% avg").assertExists()
        compose.onNodeWithContentDescription("20\u219280% avg").assertExists()
        compose.onNodeWithContentDescription("DC Sessions").assertExists()
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
        compose.onNodeWithText("Yearly Charging Speed Trend").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
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
        compose.onNodeWithText("Yearly Charging Speed Trend").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
