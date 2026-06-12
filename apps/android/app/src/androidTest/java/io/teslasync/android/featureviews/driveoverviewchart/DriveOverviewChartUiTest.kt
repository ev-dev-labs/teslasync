package io.teslasync.android.featureviews.driveoverviewchart

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
 * On-device Compose UI + accessibility verification of [DriveOverviewChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * composed chart with its rich Mean/Max/Min legend, and the stale/offline cached view. Asserts the rendered
 * i18n strings, the chart's accessible description (web `ariaLabel`, resolved via the catalog-absent
 * fallback), the grouped legend row's TalkBack label, and the freshness chip's TalkBack label. The offline
 * gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx).
 */
class DriveOverviewChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val ariaLabel = "Drive overview composed chart of speed, range, SOC and power over time"

    private fun setContent(
        state: UiState<List<DriveChartPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DriveOverviewChartContent(
                    state = state,
                    onRetry = onRetry,
                    syncId = null,
                    speedUnit = "mph",
                    distanceUnit = "mi",
                    locale = Locale.US,
                )
            }
        }
    }

    private fun trace(): List<DriveChartPoint> =
        listOf(
            DriveChartPoint("09:00", speed = 0.0, battery = 80.0, power = 10.0, idealRange = 300.0, estRange = 280.0, usableSoc = 78.0),
            DriveChartPoint("09:05", speed = 40.0, battery = 78.0, power = 50.0, idealRange = 290.0, estRange = 270.0, usableSoc = 76.0),
            DriveChartPoint("09:10", speed = 80.0, battery = 76.0, power = -30.0, idealRange = 280.0, estRange = 260.0, usableSoc = 74.0),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Drive Overview").assertIsDisplayed()
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
        compose.onNodeWithText("Drive Overview").assertIsDisplayed()
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun singleSampleRendersEmptyStateMirroringLengthGreaterThanOne() {
        // The web `chartData.length > 1` boundary: one sample is the empty surface, never a one-point chart.
        setContent(UiState(UiPhase.Content, data = listOf(trace().first())))
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndRichLegend() {
        setContent(UiState(UiPhase.Content, data = trace()))
        compose.onNodeWithText("Drive Overview").assertIsDisplayed()
        compose.onNodeWithContentDescription(ariaLabel).assertExists()
        // The speed legend row is a grouped node whose TalkBack label carries the label + Mean/Max/Min stats.
        compose.onNodeWithContentDescription("Speed.", substring = true).assertExists()
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
        compose.onNodeWithText("Drive Overview").assertIsDisplayed()
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
        compose.onNodeWithText("Drive Overview").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
