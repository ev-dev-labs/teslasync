package io.teslasync.android.featureviews.speedtrendchart

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
 * On-device Compose UI + accessibility verification of [SpeedTrendChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * two-line chart with its axis label + legend, and the stale/offline cached views. Asserts the rendered
 * i18n strings and the TalkBack content descriptions (the always-visible title/subtitle, the "Avg kW" axis
 * label, the legend swatch labels, the offline freshness chip). The offline gate's `testReleaseUnitTest`
 * covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx).
 */
class SpeedTrendChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<ChargingSpeedSession>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SpeedTrendChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun sessions(): List<ChargingSpeedSession> =
        listOf(
            ChargingSpeedSession(startedAt = "2026-02-04T08:00:00Z", peakPowerW = 120_000.0, chargerType = "Tesla"),
            ChargingSpeedSession(startedAt = "2026-03-21T23:10:00Z", peakPowerW = 11_000.0, chargerType = null),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Charging Speed Trend").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Charging Speed Trend").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Charging Speed Trend").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleSubtitleAxisLabelAndAccessibleLegend() {
        setContent(UiState(UiPhase.Content, data = sessions()))
        compose.onNodeWithText("Charging Speed Trend").assertIsDisplayed()
        compose.onNodeWithText("Monthly average DC vs AC charge rate").assertIsDisplayed()
        compose.onNodeWithText("Avg kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("DC Fast").assertExists()
        compose.onNodeWithContentDescription("AC / Home").assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sessions(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Charging Speed Trend").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sessions(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Charging Speed Trend").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
