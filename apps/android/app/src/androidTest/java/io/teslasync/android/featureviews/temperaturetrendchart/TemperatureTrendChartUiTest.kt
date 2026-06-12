package io.teslasync.android.featureviews.temperaturetrendchart

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
 * On-device Compose UI + accessibility verification of [TemperatureTrendChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * line chart with its axis unit + legend + Warm Zone / Freezing threshold chips, and the stale/offline
 * cached views. Asserts the rendered i18n strings and the TalkBack content descriptions (the always-visible
 * title/subtitle, the legend swatch label, the threshold chip labels, the offline freshness chip). The
 * offline-capable `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web
 * spec (web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx).
 */
class TemperatureTrendChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<TempTrendPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TemperatureTrendChartContent(state = state, onRetry = onRetry)
            }
        }
    }

    private fun points(): List<TempTrendPoint> =
        listOf(
            TempTrendPoint(date = "Feb 04", outsideTempC = -2.0),
            TempTrendPoint(date = "Feb 19", outsideTempC = 8.5),
            TempTrendPoint(date = "Mar 06", outsideTempC = 21.0),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Temperature Trend").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Temperature Trend").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Temperature Trend").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleSubtitleLegendAndThresholdChips() {
        setContent(UiState(UiPhase.Content, data = points()))
        compose.onNodeWithText("Temperature Trend").assertIsDisplayed()
        compose.onNodeWithText("Outside temperature recorded during recent drives").assertIsDisplayed()
        compose.onNodeWithContentDescription("Outside Temp").assertExists()
        compose.onNodeWithContentDescription("Warm Zone", substring = true).assertExists()
        compose.onNodeWithContentDescription("Freezing", substring = true).assertExists()
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
        compose.onNodeWithText("Temperature Trend").assertIsDisplayed()
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
        compose.onNodeWithText("Temperature Trend").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
