package io.teslasync.android.featureviews.userimpersonatebutton

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [UserImpersonateButtonContent] across every state the
 * surface renders: the enabled idle button, the in-flight "Starting…" button, the loading/empty/open-mode/
 * error/offline chrome, the parent-disabled button, and the stale auto-refresh. Also drives the web contract
 * tests — click opens the warning ConfirmDialog with the subject in the body, Cancel closes it without firing
 * the start mutation, and Confirm fires `onStart(subject)`. Asserts the rendered i18n strings, the TalkBack
 * content descriptions, and the web-parity test tag. Runs under `connectedAndroidTest`. Mirrors the web spec
 * (web/src/features/admin/components/UserImpersonateButton.tsx + UserImpersonateButton.test.tsx).
 */
class UserImpersonateButtonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val subject = "alice"
    private val tag = "user-impersonate-button-alice"

    private fun content(
        mode: ImpersonationMode = ImpersonationMode.Inactive,
        phase: UiPhase = UiPhase.Content,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<ImpersonationView> =
        UiState(
            phase = phase,
            data = if (phase == UiPhase.Content) ImpersonationView(mode) else null,
            stale = stale,
            errorKind = errorKind,
            fetchedAt = 1_700_000_000_000L,
        )

    private fun setContent(
        state: UiState<ImpersonationView> = content(),
        targetSubject: String = subject,
        starting: Boolean = false,
        disabled: Boolean = false,
        onStart: (String) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UserImpersonateButtonContent(
                    subject = targetSubject,
                    state = state,
                    starting = starting,
                    onStart = onStart,
                    onRetry = onRetry,
                    disabled = disabled,
                )
            }
        }
    }

    @Test
    fun idleShowsEnabledImpersonateButtonWithAccessibleLabelAndTag() {
        setContent()
        compose.onNodeWithText("Impersonate").assertIsDisplayed()
        compose.onNodeWithContentDescription("Impersonate alice").assertIsDisplayed()
        compose.onNodeWithTag(tag).assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun clickOpensConfirmDialogWithSubjectInTheBody() {
        setContent()
        compose.onNodeWithTag(tag).performClick()
        compose.onNodeWithText("Start impersonation session?").assertIsDisplayed()
        compose.onNodeWithText("alice", substring = true).assertIsDisplayed()
    }

    @Test
    fun cancelClosesDialogWithoutFiringStart() {
        var started: String? = null
        setContent(onStart = { started = it })
        compose.onNodeWithTag(tag).performClick()
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("Start impersonation session?").assertDoesNotExist()
        assertNull(started)
    }

    @Test
    fun confirmFiresOnStartWithSubject() {
        var started: String? = null
        setContent(onStart = { started = it })
        compose.onNodeWithTag(tag).performClick()
        compose.onNodeWithText("Start impersonation").performClick()
        compose.onNodeWithText("Start impersonation session?").assertDoesNotExist()
        assertEquals("alice", started)
    }

    @Test
    fun disabledPropSuppressesDialogOpen() {
        setContent(disabled = true)
        compose.onNodeWithTag(tag).assertIsNotEnabled()
        compose.onNodeWithText("Start impersonation session?").assertDoesNotExist()
    }

    @Test
    fun startingShowsStartingLabelAndDisablesTheButton() {
        setContent(starting = true)
        compose.onNodeWithText("Starting\u2026").assertIsDisplayed()
        compose.onNodeWithTag(tag).assertIsNotEnabled()
    }

    @Test
    fun loadingShowsAccessibleBusyButton() {
        setContent(state = UiState.loading())
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
    fun emptyShowsNoOtherSubjectsAffordance() {
        setContent(state = UiState(UiPhase.Empty))
        compose.onNodeWithText("No other subjects").assertIsDisplayed()
    }

    @Test
    fun openModeShowsForwardAuthAffordance() {
        setContent(state = content(mode = ImpersonationMode.Open))
        compose.onNodeWithText("forward-auth", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineShowsOfflineChipAndDisablesStart() {
        setContent(state = content(stale = true, errorKind = ErrorKind.Network))
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
        compose.onNodeWithTag(tag).assertIsNotEnabled()
    }

    @Test
    fun staleAutoRefreshesAndKeepsButtonEnabled() {
        var refreshed = false
        setContent(state = content(stale = true), onRetry = { refreshed = true })
        compose.waitForIdle()
        compose.onNodeWithText("Impersonate").assertIsDisplayed()
        compose.onNodeWithTag(tag).assertIsEnabled()
        assertTrue(refreshed)
    }
}
