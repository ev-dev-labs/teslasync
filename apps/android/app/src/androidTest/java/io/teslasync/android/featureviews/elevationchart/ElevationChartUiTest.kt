package io.teslasync.android.featureviews.elevationchart

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
 * On-device Compose UI + accessibility verification of [ElevationChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the
 * single-sample (web `chartData.length <= 1`) empty fall-through, the populated chart, and the
 * stale/offline cached view. Asserts the rendered i18n strings (the real catalog resolves the
 * `driveDetail.*` keys), the chart's accessible description (the web aria label), the gain/loss/net header,
 * the two-series legend, and the freshness chip's TalkBack label. The offline gate's `testReleaseUnitTest`
 * covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drive-detail/ElevationChart.tsx).
 */
class ElevationChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Elevation Profile"
    private val ariaLabel = "Elevation and speed area+line chart over the drive timeline"

    private fun setContent(
        state: UiState<ElevationChartData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ElevationChartContent(
                    state = state,
                    onRetry = onRetry,
                    speedUnit = "mph",
                    locale = Locale.US,
                    decimals = 0,
                )
            }
        }
    }

    private fun chartData(): ElevationChartData =
        ElevationChartData(
            samples =
                listOf(
                    ElevationSample(time = "09:00", elevationMeters = 120.0, speed = 0.0),
                    ElevationSample(time = "09:05", elevationMeters = 168.0, speed = 42.0),
                    ElevationSample(time = "09:10", elevationMeters = 210.0, speed = 65.0),
                ),
            stats = ElevationStats(elevGainMeters = 132.0, elevLossMeters = 68.0),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(title).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Elevation chart failed to load").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoTelemetryMessage() {
        setContent(UiState(UiPhase.Empty, data = ElevationChartData(emptyList(), ElevationStats(0.0, 0.0))))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun singleSampleRendersTheFriendlyEmptyStateNotABlankChart() {
        // Web `chartData.length > 1`: one point cannot draw a trace, so the empty surface shows.
        setContent(
            UiState(
                phase = UiPhase.Content,
                data =
                    ElevationChartData(
                        samples = listOf(ElevationSample("09:00", 120.0, 0.0)),
                        stats = ElevationStats(0.0, 0.0),
                    ),
            ),
        )
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleDescriptionHeaderAndLegend() {
        setContent(UiState(UiPhase.Content, data = chartData()))
        compose.onNodeWithText(title).assertIsDisplayed()
        // The chart's accessible description is the web aria label (the chart-a11y:no-table fallback).
        compose.onNodeWithContentDescription(ariaLabel).assertExists()
        // Gain / loss / net header (decimals = 0 here): 132 climbed, 68 descended, net 64.
        compose.onNodeWithText("gain", substring = true).assertIsDisplayed()
        compose.onNodeWithText("loss", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Net:", substring = true).assertIsDisplayed()
        // Two-series legend with unit-suffixed names.
        compose.onNodeWithText("Elevation (m)", substring = true).assertExists()
        compose.onNodeWithText("Speed (mph)", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = chartData(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = chartData(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText(title).assertIsDisplayed()
        assertTrue(refreshed)
    }
}
