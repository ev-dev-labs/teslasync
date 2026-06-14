package io.teslasync.android.featureviews.base64tool

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [Base64ToolContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the populated tool (title/description + the
 * Encode/Decode toggle + the input field + the always-visible empty hint), live encoding and decoding with
 * the copy affordance, the friendly invalid-decode message, and the stale/offline cached views. Asserts the
 * rendered i18n strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the pure transform logic, this covers render + a11y +
 * interactivity. Mirrors the web spec (web/src/features/admin/components/devtools/tools/Base64Tool.tsx).
 */
class Base64ToolUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<Unit>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Base64ToolContent(state = state, onRetry = onRetry)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Base64").assertIsDisplayed()
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
    fun contentRendersHeaderModeToggleAndEmptyHint() {
        setContent(UiState(UiPhase.Content, data = Unit))
        compose.onNodeWithText("Base64").assertIsDisplayed()
        compose.onNodeWithText("Base64Desc").assertIsDisplayed()
        compose.onNodeWithText("Encode").assertIsDisplayed()
        compose.onNodeWithText("Decode").assertIsDisplayed()
        compose.onNodeWithText("Enter text", substring = true).assertIsDisplayed()
    }

    @Test
    fun encodeModeEncodesTypedInput() {
        setContent(UiState(UiPhase.Content, data = Unit))
        compose.onNode(hasSetTextAction()).performTextReplacement("Hello World")
        compose
            .onNodeWithContentDescription("SGVsbG8gV29ybGQ=", substring = true)
            .assertIsDisplayed()
        compose.onNodeWithContentDescription("Copy").assertIsDisplayed()
    }

    @Test
    fun decodeModeDecodesTypedInput() {
        setContent(UiState(UiPhase.Content, data = Unit))
        compose.onNodeWithText("Decode").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("SGVsbG8gV29ybGQ=")
        compose.onNodeWithContentDescription("Hello World", substring = true).assertIsDisplayed()
    }

    @Test
    fun invalidDecodeShowsLocalizedInvalidMessage() {
        setContent(UiState(UiPhase.Content, data = Unit))
        compose.onNodeWithText("Decode").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("@@@@")
        compose.onNodeWithText("Invalid Input").assertIsDisplayed()
        compose.onNodeWithContentDescription("Output Label", substring = true).assertDoesNotExist()
    }

    @Test
    fun offlineShowsCachedToolWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = Unit,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Encode").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = Unit,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Encode").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
