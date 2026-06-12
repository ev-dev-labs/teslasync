package io.teslasync.android.featureviews.activesessionssection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
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
 * On-device Compose UI + accessibility verification of [ActiveSessionsSectionContent] across every state the
 * surface renders: the loading spinner chrome, the hard-error retry surface, the open-mode advisory, the
 * populated session list with the "This device" badge + per-row revoke + footer "Sign out all other devices",
 * the empty state, and the stale/offline cached view. Asserts the rendered i18n strings and the TalkBack
 * content descriptions (the spinner label, the per-row "Sign out {{device}}" aria, the offline chip), and that
 * both destructive actions route through their confirm dialog before firing. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/settings/components/ActiveSessionsSection.tsx).
 */
class ActiveSessionsSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val current =
        ActiveSession(
            id = "sess-1",
            userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
            ip = "203.0.113.7",
            createdAt = "2026-04-04T18:30:00Z",
            lastSeenAt = "2026-04-05T09:12:00Z",
            current = true,
        )

    private val other =
        ActiveSession(
            id = "sess-2",
            userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
            ip = "198.51.100.22",
            createdAt = "2026-04-01T08:00:00Z",
            lastSeenAt = "2026-04-03T22:45:00Z",
            current = false,
        )

    private fun sessionData(sessions: List<ActiveSession> = listOf(current, other)) =
        ActiveSessionsData(mode = SessionMode.Session, sessions = sessions)

    private fun setContent(
        state: UiState<ActiveSessionsData>,
        onRevoke: (String) -> Unit = {},
        onRevokeAllOthers: () -> Unit = {},
        onRetry: () -> Unit = {},
        revokingId: String? = null,
        revokingAll: Boolean = false,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActiveSessionsSectionContent(
                    state = state,
                    onRevoke = onRevoke,
                    onRevokeAllOthers = onRevokeAllOthers,
                    onRetry = onRetry,
                    revokingId = revokingId,
                    revokingAll = revokingAll,
                    locale = Locale.US,
                    formatTimestamp = { raw -> raw },
                )
            }
        }
    }

    @Test
    fun loadingShowsSpinnerChromeAndLoadingTextNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Loading sessions\u2026").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading sessions\u2026").assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Failed to load active sessions.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun openModeShowsForwardAuthAdvisory() {
        setContent(UiState(UiPhase.Content, data = ActiveSessionsData(mode = SessionMode.Open)))
        compose.onNodeWithText("Active session tracking", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentRendersHeaderDeviceRowsCurrentBadgeAndColumns() {
        setContent(UiState(UiPhase.Content, data = sessionData()))
        compose.onNodeWithText("Device").assertIsDisplayed()
        compose.onNodeWithText("IP address").assertExists()
        compose.onNodeWithText("Signed in").assertExists()
        compose.onNodeWithText("Last seen").assertExists()
        compose.onNodeWithText("This device").assertIsDisplayed()
        compose.onNodeWithText("Firefox on Windows").assertExists()
        compose.onNodeWithText("Chrome on macOS").assertExists()
        compose.onNodeWithText("Sign out all other devices").assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyNoSessionsMessage() {
        setContent(UiState(UiPhase.Empty, data = sessionData(sessions = emptyList())))
        compose.onNodeWithText("No active sessions for this account.").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sessionData(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("This device").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sessionData(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("This device").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun perRowRevokeUsesAriaLabelOpensConfirmAndInvokesRevoke() {
        var revokedId: String? = null
        setContent(state = UiState(UiPhase.Content, data = sessionData()), onRevoke = { revokedId = it })

        // The non-current row exposes the per-device "Sign out {{device}}" aria-label.
        compose.onNodeWithContentDescription("Sign out Chrome on macOS").assertExists().performClick()
        compose.onNodeWithText("Sign out this device?").assertIsDisplayed()
        compose.onNodeWithText("Keep signed in").assertIsDisplayed()

        // The dialog confirm shares the "Sign out" label with the row button; the dialog is composed last.
        compose.onAllNodesWithText("Sign out").onLast().performClick()
        assertEquals("sess-2", revokedId)
    }

    @Test
    fun revokeAllOthersOpensConfirmAndInvokesCallback() {
        var allOthers = false
        setContent(state = UiState(UiPhase.Content, data = sessionData()), onRevokeAllOthers = { allOthers = true })

        compose.onNodeWithText("Sign out all other devices").performClick()
        compose.onNodeWithText("Sign out all other devices?").assertIsDisplayed()
        compose.onNodeWithText("Sign out all others").performClick()
        assertTrue(allOthers)
    }

    @Test
    fun accessibilityLabelsPresentOnInteractiveElements() {
        setContent(UiState(UiPhase.Content, data = sessionData()))
        // Per-row revoke carries the device-specific aria-label for TalkBack.
        compose.onNodeWithContentDescription("Sign out Chrome on macOS").assertExists()
        // The current device has no revoke action, so no aria-label for it exists.
        compose.onNodeWithContentDescription("Sign out Firefox on Windows").assertDoesNotExist()
    }
}
