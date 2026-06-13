package io.teslasync.android.sharedsurfaces.aiwatchfacenlresponse

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device UI + accessibility verification of the AIWatchFaceNLResponse stateless renderer — proves every
 * lifecycle state of the web card (web/src/components/ai/AIWatchFaceNLResponse.tsx) renders with the right chrome
 * and a11y affordances: the always-present title + Helix badge + description + question input, the empty-message
 * "Ask about my car" action (a blank question is allowed — the backend default summary), the
 * thinking/live/done/empty/stale output, the offline chip + cached last-known body, and that the action + retry
 * expose click actions, the title is a heading, and the question input carries a TalkBack content description.
 * Runs on a device/emulator via `:android:connectedAndroidTest`.
 */
class AIWatchFaceNLResponseUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val inputLabel = "Your question for Helix"
    private val exampleHint = "how is my battery?"

    private fun setContent(
        state: WatchRespondUiState,
        message: String = "how is my battery?",
        canStart: Boolean = true,
        online: Boolean = true,
        nowMs: Long = 0L,
        onAsk: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AIWatchFaceNLResponseContent(
                    state = state,
                    message = message,
                    canStart = canStart,
                    online = online,
                    onMessageChange = {},
                    onAsk = onAsk,
                    nowMs = { nowMs },
                )
            }
        }
    }

    @Test
    fun idleShowsTitleBadgeDescriptionAndQuestionInput() {
        setContent(state = WatchRespondUiState(), message = "")

        compose.onNodeWithText("Ask Helix about your watch face").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("glance-style natural-language", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(inputLabel).assertIsDisplayed()
        compose.onNodeWithText(exampleHint, substring = true).assertIsDisplayed()
    }

    @Test
    fun anEmptyQuestionStillEnablesTheAction() {
        setContent(state = WatchRespondUiState(), message = "", canStart = true)

        compose
            .onNodeWithText("Ask about my car")
            .assertIsDisplayed()
            .assertHasClickAction()
            .assertIsEnabled()
    }

    @Test
    fun streamingShowsTheThinkingIndicatorAndDisablesTheAction() {
        setContent(state = WatchRespondUiState(phase = WatchRespondPhase.Streaming))

        compose.onNodeWithText("Helix is thinking", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Ask about my car").assertIsNotEnabled()
    }

    @Test
    fun streamingWithTextShowsTheLiveNarration() {
        setContent(
            state = WatchRespondUiState(phase = WatchRespondPhase.Streaming, streamingText = "Your battery is at 72%"),
        )

        compose.onNodeWithText("Your battery is at 72%").assertIsDisplayed()
    }

    @Test
    fun doneShowsTheNarratedAnswer() {
        setContent(
            state =
                WatchRespondUiState(
                    phase = WatchRespondPhase.Done,
                    committedText = "Your battery is at 72%. The car is locked.",
                    fetchedAt = 0L,
                ),
            nowMs = 1_000L,
        )

        compose.onNodeWithText("Your battery is at 72%. The car is locked.").assertIsDisplayed()
    }

    @Test
    fun doneWithNoAnswerShowsTheEmptyState() {
        setContent(state = WatchRespondUiState(phase = WatchRespondPhase.Done))

        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun aStaleAnswerShowsTheStaleChip() {
        setContent(
            state =
                WatchRespondUiState(
                    phase = WatchRespondPhase.Done,
                    committedText = "Your battery is at 72%.",
                    fetchedAt = 0L,
                ),
            nowMs = WATCH_FRESHNESS_WINDOW_MS + 10L,
        )

        compose.onNodeWithText("Stale").assertIsDisplayed()
        compose.onNodeWithText("Your battery is at 72%.").assertIsDisplayed()
    }

    @Test
    fun failedShowsTheErrorAndRetryInvokesOnAsk() {
        var retried = false
        setContent(
            state = WatchRespondUiState(phase = WatchRespondPhase.Failed, error = "stream_http_503", errorKind = ErrorKind.Http),
            onAsk = { retried = true },
        )

        compose.onNodeWithText("stream_http_503", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun aNetworkFailureWithLastKnownShowsTheOfflineChipAndCachedNarration() {
        setContent(
            state =
                WatchRespondUiState(
                    phase = WatchRespondPhase.Failed,
                    committedText = "Your battery is at 72%.",
                    error = "network",
                    errorKind = ErrorKind.Network,
                ),
        )

        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Your battery is at 72%.").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction()
    }

    @Test
    fun offlineShowsTheOfflineChipAndDisablesTheAction() {
        setContent(state = WatchRespondUiState(), canStart = false, online = false)

        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Ask about my car").assertIsNotEnabled()
    }

    @Test
    fun theTitleIsExposedAsAHeadingForTalkBack() {
        setContent(state = WatchRespondUiState())

        compose
            .onNodeWithText("Ask Helix about your watch face")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    @Test
    fun theQuestionInputExposesAContentDescriptionForTalkBack() {
        setContent(state = WatchRespondUiState(), message = "")

        compose.onNodeWithContentDescription(inputLabel).assertIsDisplayed()
    }
}
