package io.teslasync.android.featureviews.alertdetailtimeline

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.notifications.AlertEvent
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [AlertDetailTimelineContent] across every state the
 * surface renders: the loading skeleton, the hard-error retry surface, the no-events empty state, the
 * populated timeline, and the stale/offline cached views. Asserts the rendered i18n strings and the TalkBack
 * content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/admin/components/AlertDetailTimeline.tsx).
 */
class AlertDetailTimelineUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<AlertEvent>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AlertDetailTimelineContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                    zoneId = ZoneOffset.UTC,
                )
            }
        }
    }

    private fun events(): List<AlertEvent> =
        listOf(
            AlertEvent(id = 0, occurredAt = "2026-04-04T14:30:00Z", actor = null, kind = "created", note = null),
            AlertEvent(
                id = 1,
                occurredAt = "2026-04-04T15:00:00Z",
                actor = "Atul",
                kind = "acknowledged",
                note = "Looks fine",
            ),
        )

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
    fun emptyShowsAuditTimelineTitleAndNoEventsMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No events yet").assertIsDisplayed()
        compose.onNodeWithContentDescription("Audit timeline").assertIsDisplayed()
    }

    @Test
    fun contentRendersEventTitlesAndAccessibleTimeline() {
        setContent(UiState(UiPhase.Content, data = events()))
        compose.onNodeWithText("Alert created").assertIsDisplayed()
        compose.onNodeWithText("Acknowledged by Atul").assertIsDisplayed()
        compose.onNodeWithText("Looks fine").assertIsDisplayed()
        compose.onNodeWithContentDescription("Audit timeline").assertIsDisplayed()
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
        compose.onNodeWithText("Alert created").assertIsDisplayed()
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
        compose.onNodeWithText("Alert created").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
