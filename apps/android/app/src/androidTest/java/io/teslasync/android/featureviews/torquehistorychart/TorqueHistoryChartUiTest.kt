package io.teslasync.android.featureviews.torquehistorychart

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
 * On-device Compose UI + accessibility verification of [TorqueHistoryChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the
 * single-sample and all-null empty boundary (web `data.length <= 1 || !data.some(d => d.torque !== null)`),
 * the populated area chart with its title + subtitle + accessible description + expandable data table, and
 * the stale/offline cached view with auto-refresh. Asserts the rendered i18n strings, the chart's accessible
 * description (web `ariaLabel`, resolved via the catalog-absent fallback), and the freshness chip's TalkBack
 * label. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors
 * the web spec (web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx).
 */
class TorqueHistoryChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Motor Torque"
    private val subtitle = "Drive inverter torque output over time"
    private val ariaLabel = "Motor inverter torque output history area chart"
    private val noData = "No telemetry data available"

    private fun setContent(
        state: UiState<List<TorqueHistoryPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TorqueHistoryChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun data(): List<TorqueHistoryPoint> =
        listOf(
            TorqueHistoryPoint("09:00", 120.0),
            TorqueHistoryPoint("09:05", null),
            TorqueHistoryPoint("09:10", -90.0),
            TorqueHistoryPoint("09:15", 210.0),
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
    fun emptyShowsTitleSubtitleAndNoTelemetryMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(subtitle).assertIsDisplayed()
        compose.onNodeWithText(noData).assertIsDisplayed()
    }

    @Test
    fun singleSampleRendersEmptyStateMirroringLengthGreaterThanOne() {
        // The web `data.length <= 1` boundary: one sample is the empty surface, never a one-point chart.
        setContent(UiState(UiPhase.Content, data = listOf(TorqueHistoryPoint("09:00", 120.0))))
        compose.onNodeWithText(noData).assertIsDisplayed()
    }

    @Test
    fun allNullTorqueRendersEmptyStateMirroringSomeTorqueNotNull() {
        // The web `!data.some(d => d.torque !== null)` boundary: no readings is the empty surface.
        setContent(
            UiState(
                UiPhase.Content,
                data = listOf(TorqueHistoryPoint("09:00", null), TorqueHistoryPoint("09:05", null)),
            ),
        )
        compose.onNodeWithText(noData).assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleSubtitleAccessibleChartDescriptionAndDataTable() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(subtitle).assertIsDisplayed()
        compose.onNodeWithContentDescription(ariaLabel).assertExists()
        // The accessible fallback table (web `data`/`dataColumns`) renders its expand affordance.
        compose.onNodeWithText("Details").assertIsDisplayed()
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
                    data = data(),
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
