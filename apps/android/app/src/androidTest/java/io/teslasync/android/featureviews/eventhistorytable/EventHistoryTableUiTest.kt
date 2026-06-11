package io.teslasync.android.featureviews.eventhistorytable

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.ui.SortState
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
 * On-device Compose UI + accessibility verification of [EventHistoryTableContent] across every state the
 * surface renders: the loading skeleton, the hard-error retry surface, the no-events empty message, the
 * populated five-column table, and the stale/offline cached views. Asserts the rendered i18n strings, the
 * sortable `createdAt` header interaction, and that the interactive pagination controls carry TalkBack
 * labels. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure model.
 * Mirrors the web spec (web/src/features/admin/components/security-access/EventHistoryTable.tsx).
 */
class EventHistoryTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<SecurityEvent>>,
        onRetry: () -> Unit = {},
        sortState: SortState = SortState(),
        onSortChange: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EventHistoryTableContent(
                    state = state,
                    onRetry = onRetry,
                    sortState = sortState,
                    onSortChange = onSortChange,
                    locale = Locale.US,
                    zoneId = ZoneOffset.UTC,
                )
            }
        }
    }

    private fun events(): List<SecurityEvent> =
        listOf(
            SecurityEvent(
                id = "1",
                createdAt = "2026-04-04T14:30:00Z",
                locked = true,
                sentryMode = SignalValue.StringValue("SentryModeStateOn"),
                doorState = SignalValue.StringValue("Closed"),
                fdWindow = SignalValue.StringValue("Closed"),
                fpWindow = SignalValue.StringValue("Closed"),
                rdWindow = SignalValue.StringValue("Closed"),
                rpWindow = SignalValue.StringValue("Closed"),
            ),
            SecurityEvent(
                id = "2",
                createdAt = "2026-04-04T13:00:00Z",
                locked = false,
                sentryMode = SignalValue.BoolValue(false),
                doorState = SignalValue.StringValue("Front Left Open"),
                fdWindow = SignalValue.StringValue("Open"),
                fpWindow = SignalValue.StringValue("Closed"),
                rdWindow = SignalValue.StringValue("Closed"),
                rpWindow = SignalValue.StringValue("Closed"),
            ),
        )

    @Test
    fun panelTitleAndAllColumnHeadersAreDisplayed() {
        setContent(UiState(UiPhase.Content, data = events()))
        compose.onNodeWithText("Security Event History").assertIsDisplayed()
        compose.onNodeWithText("Time").assertIsDisplayed()
        compose.onNodeWithText("Lock").assertIsDisplayed()
        compose.onNodeWithText("Sentry").assertIsDisplayed()
        compose.onNodeWithText("Doors").assertIsDisplayed()
        compose.onNodeWithText("Windows").assertIsDisplayed()
    }

    @Test
    fun dataRendersEveryColumnCell() {
        setContent(UiState(UiPhase.Content, data = events()))
        // Lock + Sentry badges (both rows), Doors raw string, Windows summary (all-closed + open count).
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithText("Unlocked").assertIsDisplayed()
        compose.onNodeWithText("On").assertIsDisplayed()
        compose.onNodeWithText("Off").assertIsDisplayed()
        compose.onNodeWithText("Front Left Open").assertIsDisplayed()
        compose.onNodeWithText("All Closed").assertIsDisplayed()
        compose.onNodeWithText("1 Open/Venting").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsNoEventsMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No security events recorded yet.").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = events(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = events(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Locked").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun sortHeaderTriggersSortCallbackForTimeColumn() {
        var sortedKey: String? = null
        setContent(UiState(UiPhase.Content, data = events()), onSortChange = { sortedKey = it })
        compose.onNodeWithText("Time").performClick()
        assertEquals("createdAt", sortedKey)
    }

    @Test
    fun paginationControlIsLabeledForAccessibility() {
        setContent(UiState(UiPhase.Content, data = events()))
        // The pagination footer renders when rows are present; its first-page control carries a TalkBack label.
        compose.onNodeWithContentDescription("First page").assertIsDisplayed()
    }
}
