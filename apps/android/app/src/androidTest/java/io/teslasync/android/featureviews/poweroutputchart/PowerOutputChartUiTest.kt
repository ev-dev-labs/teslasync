package io.teslasync.android.featureviews.poweroutputchart

import androidx.compose.ui.test.assertHasClickAction
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
 * On-device Compose UI + accessibility verification of [PowerOutputChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the single-
 * drive empty state (web `data.length <= 1`), the populated two-area chart with its title / subtitle /
 * accessible description / interactive legend / data table, the click-to-hide legend toggle, and the
 * stale/offline cached view. Asserts the rendered i18n strings, the chart's accessible description (web
 * `ariaLabel`, resolved via the catalog-absent fallback), the legend chips' interactivity + hidden-state
 * announcement (web `useHiddenSeries`), and the freshness chip's TalkBack label. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx).
 */
class PowerOutputChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Power Output History"
    private val subtitle = "Peak and regen power per drive over time"
    private val ariaLabel = "Per-drive peak and regen motor power output history area chart"
    private val peakLabel = "Peak Power (kW)"
    private val regenLabel = "Regen Power (kW)"

    private fun setContent(
        state: UiState<List<PowerOutputPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PowerOutputChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun drives(): List<PowerOutputPoint> =
        listOf(
            PowerOutputPoint("Feb 04", powerMax = 211.4, powerMin = -64.2),
            PowerOutputPoint("Feb 11", powerMax = 188.0, powerMin = -52.7),
            PowerOutputPoint("Feb 18", powerMax = 233.9, powerMin = -71.0),
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
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun singleDriveRendersEmptyStateMirroringLengthBoundary() {
        // The web `data.length <= 1` boundary: one drive is the empty surface, never a one-point chart.
        setContent(UiState(UiPhase.Content, data = listOf(PowerOutputPoint("Feb 04", 211.4, -64.2))))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleSubtitleAccessibleDescriptionAndLegend() {
        setContent(UiState(UiPhase.Content, data = drives()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(subtitle).assertIsDisplayed()
        // The chart body carries the web ariaLabel as its screen-reader description.
        compose.onNodeWithContentDescription(ariaLabel).assertExists()
        // Both series appear in the interactive legend.
        compose.onNodeWithText(peakLabel).assertExists()
        compose.onNodeWithText(regenLabel).assertExists()
        // The accessible fallback data table is offered (collapsed by default).
        compose.onNodeWithText("Details").assertExists()
    }

    @Test
    fun legendChipIsInteractiveAndTogglesHiddenState() {
        // The web `useHiddenSeries` click-to-hide: the legend chip is a button, and tapping it marks the
        // series hidden (announced via the chip's content description).
        setContent(UiState(UiPhase.Content, data = drives()))
        compose.onNodeWithContentDescription(peakLabel).assertHasClickAction()
        compose.onNodeWithContentDescription(peakLabel).performClick()
        compose.onNodeWithContentDescription("$peakLabel, hidden").assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = drives(),
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
                    data = drives(),
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
