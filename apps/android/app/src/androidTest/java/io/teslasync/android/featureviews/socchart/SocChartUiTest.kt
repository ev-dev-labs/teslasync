package io.teslasync.android.featureviews.socchart

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
 * On-device Compose UI + accessibility verification of [SocChartContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated SOC area
 * chart, and the stale/offline cached view. Asserts the rendered i18n strings, the chart's accessible
 * description (web `ariaLabel`, resolved via the catalog-absent fallback), and the freshness chip's TalkBack
 * label. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors
 * the web spec (web/src/features/driving/components/drive-detail/SocChart.tsx).
 */
class SocChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "SOC % Over Time"
    private val ariaLabel = "State of charge percent over time area chart"

    private fun setContent(
        state: UiState<List<SocChartPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SocChartContent(
                    state = state,
                    onRetry = onRetry,
                    syncId = null,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun trace(): List<SocChartPoint> =
        listOf(
            SocChartPoint("09:00", battery = 88.0),
            SocChartPoint("09:05", battery = 86.0),
            SocChartPoint("09:10", battery = 83.0),
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
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoTelemetryMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun singleSampleRendersEmptyStateMirroringLengthGreaterThanOne() {
        // The web `chartData.length > 1` boundary: one sample is the empty surface, never a one-point area.
        setContent(UiState(UiPhase.Content, data = listOf(trace().first())))
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAndAccessibleChartDescription() {
        setContent(UiState(UiPhase.Content, data = trace()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithContentDescription(ariaLabel).assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = trace(),
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
                    data = trace(),
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
