package io.teslasync.android.featureviews.chatmessageitem

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ChatMessageItemContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the empty state, the loaded user/assistant rows,
 * the inline-edit flow, and the stale/offline cached views. Asserts the rendered i18n strings, that the actions
 * fire their callbacks, and that the TalkBack content descriptions are present. Runs under `connectedAndroidTest`;
 * the offline `testReleaseUnitTest` gate covers the pure logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/system/components/chatbot/ChatMessageItem.tsx).
 */
class ChatMessageItemUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun userMessage(): UIChatMessage =
        UIChatMessage(
            id = 1,
            role = ChatRole.User,
            content = USER_TEXT,
            createdAt = "2026-04-04T14:30:00Z",
        )

    private fun assistantMessage(): UIChatMessage =
        UIChatMessage(
            id = 2,
            role = ChatRole.Assistant,
            content = ASSISTANT_TEXT,
            createdAt = "2026-04-04T14:31:00Z",
        )

    @Suppress("LongParameterList")
    private fun setContent(
        state: UiState<UIChatMessage>,
        isLastAssistant: Boolean = false,
        isLastUser: Boolean = false,
        isFirstInGroup: Boolean = true,
        isLastInGroup: Boolean = true,
        actionsDisabled: Boolean = false,
        actions: ChatMessageItemActions = ChatMessageItemActions(),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChatMessageItemContent(
                    state = state,
                    isLastAssistant = isLastAssistant,
                    isLastUser = isLastUser,
                    isFirstInGroup = isFirstInGroup,
                    isLastInGroup = isLastInGroup,
                    actionsDisabled = actionsDisabled,
                    actions = actions,
                    onRetry = onRetry,
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
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertEquals(true, retried)
    }

    @Test
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun lastUserMessageRendersTextCopyAndEditAffordances() {
        setContent(
            state = UiState(UiPhase.Content, data = userMessage()),
            isLastUser = true,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> }),
        )
        compose.onNodeWithText(USER_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription("Copy message").assertIsDisplayed()
        compose.onNodeWithContentDescription("Edit and resend").assertIsDisplayed()
        compose.onNodeWithText("Edit").assertIsDisplayed()
    }

    @Test
    fun lastAssistantMessageRendersTextCopyAndRegenerateAffordances() {
        setContent(
            state = UiState(UiPhase.Content, data = assistantMessage()),
            isLastAssistant = true,
            actions = ChatMessageItemActions(onRegenerate = {}),
        )
        compose.onNodeWithText(ASSISTANT_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription("Copy message").assertIsDisplayed()
        compose.onNodeWithContentDescription("Regenerate response").assertIsDisplayed()
        compose.onNodeWithText("Regenerate").assertIsDisplayed()
    }

    @Test
    fun regenerateActionInvokesCallbackWithMessage() {
        var regeneratedId: Long? = null
        setContent(
            state = UiState(UiPhase.Content, data = assistantMessage()),
            isLastAssistant = true,
            actions = ChatMessageItemActions(onRegenerate = { regeneratedId = it.id }),
        )
        compose.onNodeWithContentDescription("Regenerate response").performClick()
        assertEquals(2L, regeneratedId)
    }

    @Test
    fun editActionEntersEditModeWithAccessibleTextareaAndButtons() {
        setContent(
            state = UiState(UiPhase.Content, data = userMessage()),
            isLastUser = true,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> }),
        )
        compose.onNodeWithContentDescription("Edit and resend").performClick()
        compose.onNodeWithContentDescription("Edit message").assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
        compose.onNodeWithText("Save & resend").assertIsDisplayed()
    }

    @Test
    fun editAndResendInvokesCallbackWithTheTrimmedChangedDraft() {
        var resent: Pair<Long, String>? = null
        setContent(
            state = UiState(UiPhase.Content, data = userMessage()),
            isLastUser = true,
            actions = ChatMessageItemActions(onEditAndResend = { message, text -> resent = message.id to text }),
        )
        compose.onNodeWithContentDescription("Edit and resend").performClick()
        compose.onNodeWithContentDescription("Edit message").performTextReplacement("Updated question")
        compose.onNodeWithText("Save & resend").performClick()
        assertEquals(1L to "Updated question", resent)
    }

    @Test
    fun cancelEditLeavesEditModeWithoutResending() {
        var resent = false
        setContent(
            state = UiState(UiPhase.Content, data = userMessage()),
            isLastUser = true,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> resent = true }),
        )
        compose.onNodeWithContentDescription("Edit and resend").performClick()
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithContentDescription("Edit message").assertDoesNotExist()
        compose.onNodeWithText("Save & resend").assertDoesNotExist()
        compose.onNodeWithText(USER_TEXT).assertIsDisplayed()
        assertEquals(false, resent)
    }

    @Test
    fun streamingSuppressesTheActionRowAndShowsTheRevealedText() {
        setContent(
            state =
                UiState(
                    UiPhase.Content,
                    data = assistantMessage().copy(isStreaming = true, streamedText = STREAMED_TEXT),
                ),
            isLastAssistant = true,
            actions = ChatMessageItemActions(onRegenerate = {}),
        )
        compose.onNodeWithText(STREAMED_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription("Copy message").assertDoesNotExist()
        compose.onNodeWithContentDescription("Regenerate response").assertDoesNotExist()
    }

    @Test
    fun actionsDisabledHidesTheActionRowButStillRendersTheMessage() {
        setContent(
            state = UiState(UiPhase.Content, data = userMessage()),
            isLastUser = true,
            actionsDisabled = true,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> }),
        )
        compose.onNodeWithText(USER_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription("Copy message").assertDoesNotExist()
        compose.onNodeWithContentDescription("Edit and resend").assertDoesNotExist()
    }

    @Test
    fun nonLastUserMessageHidesTheEditAffordance() {
        setContent(
            state = UiState(UiPhase.Content, data = userMessage()),
            isLastUser = false,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> }),
        )
        compose.onNodeWithContentDescription("Copy message").assertIsDisplayed()
        compose.onNodeWithContentDescription("Edit and resend").assertDoesNotExist()
    }

    @Test
    fun nonLastAssistantMessageHidesTheRegenerateAffordance() {
        setContent(
            state = UiState(UiPhase.Content, data = assistantMessage()),
            isLastAssistant = false,
            actions = ChatMessageItemActions(onRegenerate = {}),
        )
        compose.onNodeWithContentDescription("Copy message").assertIsDisplayed()
        compose.onNodeWithContentDescription("Regenerate response").assertDoesNotExist()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = userMessage(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            isLastUser = true,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> }),
        )
        compose.onNodeWithText(USER_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = userMessage(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            isLastUser = true,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> }),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText(USER_TEXT).assertIsDisplayed()
        assertEquals(true, refreshed)
    }

    private companion object {
        const val USER_TEXT = "What's my battery health right now?"
        const val ASSISTANT_TEXT = "Your battery health is estimated at 94%."
        const val STREAMED_TEXT = "Your battery health is estimated"
    }
}
