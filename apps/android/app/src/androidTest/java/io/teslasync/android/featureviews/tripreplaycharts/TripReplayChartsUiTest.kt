package io.teslasync.android.featureviews.tripreplaycharts

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [TripReplayChartsContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the empty state, the populated
 * speed+power timeline (with its accessible chart description + the "Click to seek replay position" tap
 * affordance), the seek interaction itself, and the stale/offline cached view with auto-refresh. Mirrors the
 * web spec (web/src/features/trips/components/TripReplayCharts.tsx).
 *
 * `syncId` is `null` throughout so each test is isolated from the process-wide cursor-sync store; the seek
 * path under test is the direct tap (web `onClick`), which never touches that store.
 */
class TripReplayChartsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val seekLabel = "Click to seek replay position"
    private val ariaLabel = "Trip replay speed and power timeline area chart"

    private fun points(count: Int = 5): List<TripReplayChartPoint> =
        (0 until count).map { i ->
            TripReplayChartPoint(index = i, time = i.toDouble(), speed = (i * 20).toDouble(), power = (i * 15).toDouble())
        }

    private fun setContent(
        state: UiState<List<TripReplayChartPoint>>,
        currentIndex: Int = 0,
        onSeekToIndex: (Int) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TripReplayChartsContent(
                    state = state,
                    currentIndex = currentIndex,
                    onSeekToIndex = onSeekToIndex,
                    onRetry = onRetry,
                    syncId = null,
                    speedUnit = "mph",
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun headerAlwaysRendersTitleAndSubtitle() {
        setContent(UiState(UiPhase.Content, data = points()))
        compose.onNodeWithText("Speed & Power Timeline").assertIsDisplayed()
        compose.onNodeWithText(seekLabel).assertIsDisplayed()
    }

    @Test
    fun loadingRendersChromeNotABlankPanel() {
        // Even before any data arrives the panel keeps its title chrome (never collapses to a blank box).
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Speed & Power Timeline").assertIsDisplayed()
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
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun contentExposesAccessibleChartDescriptionAndSeekAffordance() {
        setContent(UiState(UiPhase.Content, data = points()))
        // The chart's accessible description (web `ariaLabel`) and the seek affordance (web subtitle/onClick)
        // are both announced to TalkBack — no interactive element is left unlabeled.
        compose.onNodeWithContentDescription(ariaLabel, useUnmergedTree = true).assertExists()
        compose.onNodeWithContentDescription(seekLabel, useUnmergedTree = true).assertExists()
    }

    @Test
    fun tappingTheTimelineSeeksToTheNearestSample() {
        var seeked: Int? = null
        setContent(state = UiState(UiPhase.Content, data = points()), onSeekToIndex = { seeked = it })
        // A click at the overlay center maps to the middle sample (fraction 0.5 → index 2 of 5).
        compose.onNodeWithContentDescription(seekLabel, useUnmergedTree = true).performClick()
        assertEquals(2, seeked)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = points(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Speed & Power Timeline").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleNonErrorTriggersAutoRefresh() {
        var retried = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = points(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { retried = true },
        )
        compose.waitForIdle()
        assertTrue(retried)
    }
}
