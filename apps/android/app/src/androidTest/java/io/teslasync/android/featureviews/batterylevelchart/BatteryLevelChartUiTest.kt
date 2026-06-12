package io.teslasync.android.featureviews.batterylevelchart

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
 * On-device Compose UI + accessibility verification of [BatteryLevelChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * chart, and the stale/offline cached view. Asserts the rendered i18n strings, the chart's accessible
 * description (web title + hint), the accessible data table, and the freshness chip's TalkBack label. The
 * offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web
 * spec (web/src/features/charging/components/charging-list/BatteryLevelChart.tsx).
 */
class BatteryLevelChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Battery Level at Charge Start"

    private fun setContent(
        state: UiState<List<StartLevelBucket>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryLevelChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun buckets(): List<StartLevelBucket> =
        listOf(
            StartLevelBucket("0-10%", 2),
            StartLevelBucket("10-20%", 5),
            StartLevelBucket("20-30%", 3),
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
    fun allZeroBucketsRenderTheFriendlyEmptyStateNotABlankChart() {
        setContent(UiState(UiPhase.Content, data = BatteryLevelChartProjection.distribution(emptyList())))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndDataTable() {
        setContent(UiState(UiPhase.Content, data = buckets()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose
            .onNodeWithContentDescription("Battery Level at Charge Start How low do you typically go before charging?")
            .assertExists()
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
                    data = buckets(),
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
