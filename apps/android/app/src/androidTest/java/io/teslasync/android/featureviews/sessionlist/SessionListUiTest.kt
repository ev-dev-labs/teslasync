package io.teslasync.android.featureviews.sessionlist

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId

/**
 * On-device Compose UI + accessibility verification of [SessionListContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the empty state, the loaded list, and the
 * stale/offline cached views. Asserts the rendered i18n strings, that the actions fire their callbacks (select,
 * new-chat, rename, delete-with-confirm), and that the TalkBack content descriptions are present on every
 * interactive affordance. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the
 * pure logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/system/components/chatbot/SessionList.tsx).
 */
class SessionListUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val zone = ZoneId.of("UTC")
    private val now = 1_800_000_000_000L

    private fun sessions(): List<ChatSessionInfo> =
        listOf(
            ChatSessionInfo(
                id = "s1",
                title = "Charging cost",
                firstMessage = "What did my fleet cost?",
                messageCount = 8,
                lastMessageAt = "2026-04-04T14:30:00Z",
            ),
            ChatSessionInfo(
                id = "s2",
                title = null,
                firstMessage = null,
                messageCount = 0,
                lastMessageAt = null,
            ),
        )

    private fun setContent(
        state: UiState<List<ChatSessionInfo>>,
        activeSessionId: String = "s1",
        actions: SessionListActions = SessionListActions(),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SessionListContent(
                    state = state,
                    activeSessionId = activeSessionId,
                    actions = actions,
                    onRetry = onRetry,
                    nowMillis = now,
                    zoneId = zone,
                )
            }
        }
    }

    @Test
    fun newChatButtonAndSessionsLabelRenderInEveryState() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("New Chat").assertIsDisplayed()
        compose.onNodeWithText("Sessions").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading, data = emptyList()))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, data = emptyList(), errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoConversationsMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No conversations yet").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitlesMessageCountAndDeleteAffordance() {
        setContent(UiState(UiPhase.Content, data = sessions()))
        compose.onNodeWithText("Charging cost").assertIsDisplayed()
        compose.onNodeWithText("Untitled conversation").assertIsDisplayed()
        compose.onNodeWithText("8 msgs", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Empty", substring = true).assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Delete conversation").onFirst().assertIsDisplayed()
    }

    @Test
    fun selectingARowInvokesCallback() {
        var selected: String? = null
        setContent(
            state = UiState(UiPhase.Content, data = sessions()),
            actions = SessionListActions(onSelect = { selected = it }),
        )
        compose.onNodeWithText("Charging cost").performClick()
        assertEquals("s1", selected)
    }

    @Test
    fun newChatInvokesCallback() {
        var created = false
        setContent(
            state = UiState(UiPhase.Content, data = sessions()),
            actions = SessionListActions(onNewChat = { created = true }),
        )
        compose.onNodeWithText("New Chat").performClick()
        assertTrue(created)
    }

    @Test
    fun deletingARowConfirmsBeforeInvokingCallback() {
        var deleted: String? = null
        setContent(
            state = UiState(UiPhase.Content, data = sessions()),
            actions = SessionListActions(onDelete = { deleted = it }),
        )
        compose.onAllNodesWithContentDescription("Delete conversation").onFirst().performClick()
        compose.onNodeWithText("Delete conversation?").assertIsDisplayed()
        compose.onNodeWithText("Delete").performClick()
        assertEquals("s1", deleted)
    }

    @Test
    fun longPressStartsInlineRenameWithAnAccessibleLabel() {
        setContent(UiState(UiPhase.Content, data = sessions()))
        compose.onNodeWithText("Charging cost").performTouchInput { longClick() }
        compose.onNodeWithContentDescription("Rename conversation").assertIsDisplayed()
    }

    @Test
    fun renameCommitsTheEditedTitleOnBlur() {
        var renamed: Pair<String, String>? = null
        setContent(
            state = UiState(UiPhase.Content, data = sessions()),
            actions = SessionListActions(onRename = { id, title -> renamed = id to title }),
        )
        compose.onNodeWithText("Charging cost").performTouchInput { longClick() }
        compose.onNodeWithContentDescription("Rename conversation").performTextReplacement("Renamed chat")
        // Tapping the New Chat button moves focus off the field — the web blur that commits the rename.
        compose.onNodeWithText("New Chat").performClick()
        compose.runOnIdle { assertEquals("s1" to "Renamed chat", renamed) }
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sessions(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Charging cost").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sessions(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Charging cost").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
