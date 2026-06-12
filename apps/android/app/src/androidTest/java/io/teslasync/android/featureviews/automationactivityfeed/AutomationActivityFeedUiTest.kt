package io.teslasync.android.featureviews.automationactivityfeed

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [AutomationActivityFeedContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the no-history empty state, the
 * populated header (title + connection chip + stats) with live events and history rows, and the stale/offline
 * cached views. Asserts the rendered i18n strings and the TalkBack content descriptions (the always-visible
 * title, the loading label, the freshness chip). The offline gate's `testReleaseUnitTest` covers the pure
 * logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/automations/pages/AutomationActivityFeed.tsx).
 */
class AutomationActivityFeedUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow: Long = 1_700_000_600_000L

    private fun setContent(
        state: UiState<AutomationActivityData>,
        liveEvents: List<AutomationLiveEvent> = emptyList(),
        connectionState: LiveConnectionStatus = LiveConnectionStatus.Connected,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AutomationActivityFeedContent(
                    state = state,
                    liveEvents = liveEvents,
                    connectionState = connectionState,
                    onRetry = onRetry,
                    locale = Locale.US,
                    nowMillis = fixedNow,
                )
            }
        }
    }

    private fun entry(
        id: Long = 1,
        name: String = "Nightly charge",
        status: AutomationRunStatus = AutomationRunStatus.Success,
        error: String? = null,
    ) = AutomationHistoryEntry(
        id = id,
        automationName = name,
        status = status,
        error = error,
        triggeredAt = "2023-11-14T22:00:00Z",
        durationMs = 2000,
        actionsSucceeded = 3,
        actionsTotal = 3,
    )

    private fun data(
        history: List<AutomationHistoryEntry> = listOf(entry()),
        stats: AutomationHistoryStatsModel? =
            AutomationHistoryStatsModel(totalExecutions = 128, successRate = 94.0, avgDurationMs = 2000),
    ) = AutomationActivityData(history = history, stats = stats)

    @Test
    fun loadingShowsTitleConnectionAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("Live").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndFriendlyNoHistoryMessage() {
        setContent(UiState(UiPhase.Empty, data = data(history = emptyList(), stats = null)))
        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("No execution history yet").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleConnectionStatsAndHistoryRow() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("Live").assertIsDisplayed()
        compose.onNodeWithText("128 total").assertIsDisplayed()
        compose.onNodeWithText("94% success").assertIsDisplayed()
        compose.onNodeWithText("2.0s avg").assertIsDisplayed()
        compose.onNodeWithText("Nightly charge").assertIsDisplayed()
    }

    @Test
    fun liveEventsRenderWithNameAndTypeBadgeAndReconnectingChip() {
        setContent(
            state = UiState(UiPhase.Content, data = data()),
            liveEvents =
                listOf(
                    AutomationLiveEvent(
                        id = "ae-1",
                        type = AutomationEventType.Failed,
                        name = "Door watcher",
                        automationId = 5,
                        error = "Vehicle offline",
                        reason = null,
                    ),
                ),
            connectionState = LiveConnectionStatus.Reconnecting,
        )
        compose.onNodeWithText("Reconnecting").assertIsDisplayed()
        compose.onNodeWithText("Door watcher").assertIsDisplayed()
        compose.onNodeWithText("failed").assertIsDisplayed()
        compose.onNodeWithText("Vehicle offline").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("Nightly charge").assertIsDisplayed()
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
        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
