package io.teslasync.android.featureviews.alertcard

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.notifications.Alert
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of [AlertCardContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the empty state, the loaded card, and the
 * stale/offline cached views. Asserts the rendered i18n strings, that the actions fire their callbacks, and
 * that the TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline
 * `testReleaseUnitTest` gate covers the pure logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/notifications/components/AlertCard.tsx).
 */
class AlertCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now: Instant = Instant.parse("2026-04-04T15:00:00Z")

    private fun unreadAlert(): Alert =
        Alert(
            id = 1,
            type = "low_battery",
            severity = "warning",
            title = "Battery low",
            message = "State of charge dropped below 20% while parked.",
            isRead = false,
            createdAt = "2026-04-04T14:30:00Z",
        )

    private fun acknowledgedAlert(): Alert =
        Alert(
            id = 2,
            type = "sentry_event",
            severity = "critical",
            title = "Sentry event detected",
            message = "Motion recorded near the front-left camera.",
            isRead = true,
            createdAt = "2026-04-03T15:00:00Z",
            acknowledgedAt = "2026-04-03T15:05:00Z",
            acknowledgedBy = "Atul",
        )

    private fun setContent(
        state: UiState<Alert>,
        actions: AlertCardActions = AlertCardActions(),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AlertCardContent(state = state, actions = actions, onRetry = onRetry, now = now)
            }
        }
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
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleMessageSeverityTypeTimeAndActions() {
        setContent(UiState(UiPhase.Content, data = unreadAlert()))
        compose.onNodeWithText("Battery low").assertIsDisplayed()
        compose.onNodeWithText("State of charge dropped below 20% while parked.").assertIsDisplayed()
        compose.onNodeWithText("warning").assertIsDisplayed()
        compose.onNodeWithText("low battery").assertIsDisplayed()
        compose.onNodeWithText("30m ago").assertIsDisplayed()
        compose.onNodeWithText("View context").assertIsDisplayed()
        compose.onNodeWithText("Audit timeline").assertIsDisplayed()
        compose.onNodeWithText("Acknowledge").assertIsDisplayed()
        compose.onNodeWithText("Mark read").assertIsDisplayed()
    }

    @Test
    fun acknowledgedReadAlertShowsAckBadgeAndReopenToggle() {
        setContent(UiState(UiPhase.Content, data = acknowledgedAlert()))
        compose.onNodeWithText("Acknowledged by Atul").assertIsDisplayed()
        compose.onNodeWithText("Reopened").assertIsDisplayed()
        compose.onNodeWithText("Audit timeline").assertIsDisplayed()
    }

    @Test
    fun acknowledgeActionInvokesCallback() {
        var acknowledged = false
        setContent(
            state = UiState(UiPhase.Content, data = unreadAlert()),
            actions = AlertCardActions(onAcknowledge = { acknowledged = true }),
        )
        compose.onNodeWithText("Acknowledge").performClick()
        assertTrue(acknowledged)
    }

    @Test
    fun markReadActionInvokesCallback() {
        var marked = false
        setContent(
            state = UiState(UiPhase.Content, data = unreadAlert()),
            actions = AlertCardActions(onMarkRead = { marked = true }),
        )
        compose.onNodeWithText("Mark read").performClick()
        assertTrue(marked)
    }

    @Test
    fun openContextAndOpenDetailActionsInvokeCallbacks() {
        var openedContext = false
        var openedDetail = false
        setContent(
            state = UiState(UiPhase.Content, data = unreadAlert()),
            actions =
                AlertCardActions(
                    onOpenContext = { openedContext = true },
                    onOpenDetail = { openedDetail = true },
                ),
        )
        compose.onNodeWithText("View context").performClick()
        compose.onNodeWithText("Audit timeline").performClick()
        assertTrue(openedContext)
        assertTrue(openedDetail)
    }

    @Test
    fun reopenActionInvokesCallback() {
        var reopened = false
        setContent(
            state = UiState(UiPhase.Content, data = acknowledgedAlert()),
            actions = AlertCardActions(onReopen = { reopened = true }),
        )
        compose.onNodeWithText("Reopened").performClick()
        assertTrue(reopened)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = unreadAlert(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Battery low").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = unreadAlert(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Battery low").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
