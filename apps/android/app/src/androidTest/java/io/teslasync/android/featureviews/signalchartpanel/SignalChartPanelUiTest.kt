package io.teslasync.android.featureviews.signalchartpanel

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
 * On-device Compose UI + accessibility verification of [SignalChartPanelContent] across every state the
 * surface renders: the historical loading skeleton chrome, the live "waiting for data" state, the populated
 * overlay chart with its accessible legend, the hard-error retry surface, the stale/offline cached views, and
 * the historical no-data empty state. Asserts the rendered i18n strings (the resolved P1/S10 catalog values)
 * and the TalkBack content descriptions (the always-visible title, the legend swatch labels, the offline
 * freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y.
 * Mirrors the web spec (web/src/features/telemetry/components/SignalChartPanel.tsx).
 */
class SignalChartPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<SignalChartData>,
        isLive: Boolean = false,
        chartMode: SignalChartMode = SignalChartMode.Auto,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SignalChartPanelContent(
                    state = state,
                    onRetry = onRetry,
                    isLive = isLive,
                    chartMode = chartMode,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun rows(): List<SignalChartRow> =
        listOf(
            SignalChartRow("2026-06-12T10:00:00Z", mapOf("VehicleSpeed" to 10.0, "BatteryLevel" to 80.0)),
            SignalChartRow("2026-06-12T10:00:01Z", mapOf("VehicleSpeed" to 20.0, "BatteryLevel" to 79.0)),
        )

    private fun data(
        liveEventCount: Int? = null,
        pointsLoaded: Int? = 2,
    ): SignalChartData =
        SignalChartData(
            selectedSignals = listOf("VehicleSpeed", "BatteryLevel"),
            rows = rows(),
            stats =
                listOf(
                    SignalStat("VehicleSpeed", min = 0.0, max = 120.0, avg = 60.0, count = 2),
                    SignalStat("BatteryLevel", min = 60.0, max = 80.0, avg = 70.0, count = 2),
                ),
            pointsLoaded = pointsLoaded,
            liveEventCount = liveEventCount,
        )

    @Test
    fun historicalLoadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Signal Chart").assertIsDisplayed()
    }

    @Test
    fun liveWaitingShowsLiveTitleAndWaitingMessage() {
        setContent(UiState(UiPhase.Empty, data = SignalChartData.EMPTY), isLive = true)
        compose.onNodeWithText("Live Signals").assertIsDisplayed()
        compose.onNodeWithText("Waiting for signals\u2026").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Signal Chart").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun overlayContentRendersTitleAndAccessibleLegend() {
        setContent(UiState(UiPhase.Content, data = data()), chartMode = SignalChartMode.Overlay)
        compose.onNodeWithText("Signal Chart").assertIsDisplayed()
        compose.onNodeWithContentDescription("VehicleSpeed").assertExists()
        compose.onNodeWithContentDescription("BatteryLevel").assertExists()
    }

    @Test
    fun liveStreamingShowsLiveTitleOverContent() {
        setContent(
            UiState(UiPhase.Content, data = data(liveEventCount = 4096)),
            isLive = true,
            chartMode = SignalChartMode.Overlay,
        )
        compose.onNodeWithText("Live Signals").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Signal Chart").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
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
        compose.onNodeWithText("Signal Chart").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun historicalEmptyShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = SignalChartData.EMPTY))
        compose.onNodeWithText("Signal Chart").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }
}
