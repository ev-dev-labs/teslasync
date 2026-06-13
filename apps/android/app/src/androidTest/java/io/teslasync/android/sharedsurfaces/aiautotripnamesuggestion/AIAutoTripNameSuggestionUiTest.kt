package io.teslasync.android.sharedsurfaces.aiautotripnamesuggestion

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device UI + accessibility verification of the AIAutoTripNameSuggestion stateless renderer — proves every
 * lifecycle state of the web card (web/src/components/ai/AIAutoTripNameSuggestion.tsx) renders with the right
 * chrome and a11y affordances: the always-present title + Helix badge + propose-only description, the
 * idle/streaming/done/error output, the offline chip, and that the action + retry expose click actions and the
 * title is a heading. Runs on a device/emulator via `:android:connectedAndroidTest`.
 */
class AIAutoTripNameSuggestionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: TripNameDraftUiState,
        canStart: Boolean = true,
        online: Boolean = true,
        onSuggest: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AIAutoTripNameSuggestionContent(
                    state = state,
                    canStart = canStart,
                    online = online,
                    onSuggest = onSuggest,
                )
            }
        }
    }

    @Test
    fun idleShowsTitleBadgeDescriptionAndAnEnabledAction() {
        setContent(state = TripNameDraftUiState.IDLE)

        compose.onNodeWithText("Suggest a trip name").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("propose-only name suggestion", substring = true).assertIsDisplayed()
        compose
            .onNodeWithText("Suggest a name")
            .assertIsDisplayed()
            .assertHasClickAction()
            .assertIsEnabled()
    }

    @Test
    fun streamingShowsTheThinkingPlaceholderAndDisablesTheAction() {
        setContent(state = TripNameDraftUiState(phase = DraftPhase.Streaming))

        compose.onNodeWithText("Loading...").assertIsDisplayed()
        compose.onNodeWithText("Suggest a name").assertIsNotEnabled()
    }

    @Test
    fun doneShowsTheProposedName() {
        setContent(state = TripNameDraftUiState(phase = DraftPhase.Done, suggestion = "Sunset Coast Run"))

        compose.onNodeWithText("Sunset Coast Run").assertIsDisplayed()
    }

    @Test
    fun failedShowsTheErrorAndRetryInvokesOnSuggest() {
        var retried = false
        setContent(
            state = TripNameDraftUiState(phase = DraftPhase.Failed, error = "stream_http_503"),
            onSuggest = { retried = true },
        )

        compose.onNodeWithText("stream_http_503", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsTheOfflineChipAndDisablesTheAction() {
        setContent(state = TripNameDraftUiState.IDLE, canStart = false, online = false)

        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Suggest a name").assertIsNotEnabled()
    }

    @Test
    fun theTitleIsExposedAsAHeadingForTalkBack() {
        setContent(state = TripNameDraftUiState.IDLE)

        compose
            .onNodeWithText("Suggest a trip name")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }
}
