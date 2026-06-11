package io.teslasync.android.featureviews.entriestable

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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [EntriesTableContent] across every state the
 * surface renders: the loading skeleton, the hard-error retry surface, the no-rows empty state (the
 * table's own empty message with the header chrome still visible — never a blank box), the populated
 * table with an accessible per-row Inspect action and Replayable badge, and the stale/offline cached
 * views. Asserts the rendered i18n strings and the TalkBack content descriptions. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure logic. Mirrors the web
 * spec (web/src/features/admin/components/dlq-inspector/EntriesTable.tsx).
 */
class EntriesTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun row(): DLQEntrySummary =
        DLQEntrySummary(
            id = 1,
            arrivedAt = "2026-04-04T14:30:00Z",
            parsedReason = "decode_error",
            parsedVin = "5YJ3E1EA1KF000001",
            parsedSourceTopic = "telemetry/5YJ/v/Soc",
            parsedRedeliveries = 2,
            replayable = true,
            rawPayloadSize = 1536,
        )

    private fun setContent(
        state: UiState<List<DLQEntrySummary>>,
        onInspect: (DLQEntrySummary) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EntriesTableContent(
                    state = state,
                    onInspect = onInspect,
                    onRetry = onRetry,
                    locale = Locale.US,
                    zoneId = ZoneOffset.UTC,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsServerErrorAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyMessageAndHeaderChrome() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        // The table header still renders (never a blank box) …
        compose.onNodeWithText("Arrived").assertIsDisplayed()
        // … above the friendly empty message (web emptyMessage).
        compose.onNodeWithText("No DLQ entries \u2014 the pipeline is clean.").assertIsDisplayed()
    }

    @Test
    fun contentRendersRowReplayableBadgeAndAccessibleInspect() {
        var inspected: DLQEntrySummary? = null
        setContent(state = UiState(UiPhase.Content, data = listOf(row())), onInspect = { inspected = it })
        compose.onNodeWithText("decode_error").assertIsDisplayed()
        compose.onNodeWithText("Yes").assertIsDisplayed()
        // The Inspect affordance carries its label and an accessible click action.
        compose.onNodeWithText("Inspect").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Inspect").performClick()
        assertEquals(1L, inspected?.id)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = listOf(row()),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("decode_error").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = listOf(row()),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("decode_error").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
