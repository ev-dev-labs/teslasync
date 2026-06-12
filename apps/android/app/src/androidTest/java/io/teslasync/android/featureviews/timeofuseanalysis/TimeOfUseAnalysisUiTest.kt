package io.teslasync.android.featureviews.timeofuseanalysis

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
 * On-device Compose UI + accessibility verification of [TimeOfUseAnalysisContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty body (both the chart
 * "Not enough data" and the "No insights available" placeholders), the populated body (title, Insights
 * header, band legend, and the colored insight cards with their TalkBack descriptions), and the
 * stale/offline cached views. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers
 * render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx).
 */
class TimeOfUseAnalysisUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Electricity Rate Analysis (Time-of-Use)"

    private fun setContent(
        state: UiState<TimeOfUseData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TimeOfUseAnalysisContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun populated(): TimeOfUseData {
        val buckets =
            (0 until 24).map { hour ->
                val sessions = ((hour * 5) % 7).toLong()
                TouHourBucket(
                    hour = hour,
                    label = "${hour.toString().padStart(2, '0')}:00",
                    sessions = sessions,
                    avgCost = 0.10 + hour * 0.01,
                    totalEnergy = sessions * 8.0,
                )
            }
        val insights =
            TouInsights(
                cheapest = buckets[3],
                priciest = buckets[17],
                busiest = buckets[18],
                offPeakPct = 42.5,
            )
        return TimeOfUseData(buckets, insights)
    }

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
    fun emptyShowsTitleAndBothPlaceholders() {
        setContent(UiState(UiPhase.Empty, data = TimeOfUseData(emptyList(), null)))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("Not enough data").assertIsDisplayed()
        compose.onNodeWithText("No insights available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleInsightsLegendAndCards() {
        setContent(UiState(UiPhase.Content, data = populated()))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("Insights").assertIsDisplayed()
        compose.onNodeWithContentDescription("Peak (2", substring = true).assertExists()
        compose.onNodeWithContentDescription("Cheapest Hour", substring = true).assertExists()
        compose.onNodeWithContentDescription("Off-Peak Charging", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedBodyWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = populated(),
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
                    data = populated(),
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
