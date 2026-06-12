package io.teslasync.android.featureviews.speedhistogramchart

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
 * On-device Compose UI + accessibility verification of [SpeedHistogramChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * chart, and the stale/offline cached view. Asserts the rendered i18n strings (resolved from the real
 * P1/S10 catalog), the chart's accessible description (web `ariaLabel`), and the freshness chip's TalkBack
 * label. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors
 * the web spec (web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx).
 */
class SpeedHistogramChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<SpeedHistogramBucket>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SpeedHistogramChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun buckets(): List<SpeedHistogramBucket> =
        listOf(
            SpeedHistogramBucket(range = "0–20", pct = 12.0),
            SpeedHistogramBucket(range = "20–40", pct = 28.0),
            SpeedHistogramBucket(range = "40–60", pct = 60.0),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Speed Histogram").assertIsDisplayed()
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
        compose.onNodeWithText("Speed Histogram").assertIsDisplayed()
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndDataTable() {
        setContent(UiState(UiPhase.Content, data = buckets()))
        compose.onNodeWithText("Speed Histogram").assertIsDisplayed()
        compose.onNodeWithContentDescription("Speed-bucket distribution histogram").assertExists()
        compose.onNodeWithText("Details").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = buckets(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Speed Histogram").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = buckets(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Speed Histogram").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
