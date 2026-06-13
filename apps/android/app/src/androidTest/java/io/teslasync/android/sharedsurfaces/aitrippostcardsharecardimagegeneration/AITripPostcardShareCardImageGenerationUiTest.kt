package io.teslasync.android.sharedsurfaces.aitrippostcardsharecardimagegeneration

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
 * On-device UI + accessibility verification of the AITripPostcardShareCardImageGeneration stateless renderer —
 * proves every lifecycle state of the web card (web/src/components/ai/AITripPostcardShareCardImageGeneration.tsx)
 * renders with the right chrome and a11y affordances: the always-present title + Helix badge + propose-only
 * description, the "pick a trip" empty hint, the idle/streaming/done/empty/error output, the offline chip, and that
 * the action + retry expose click actions and the title is a heading. Runs on a device/emulator via
 * `:android:connectedAndroidTest`.
 */
class AITripPostcardShareCardImageGenerationUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: TripImageDraftUiState,
        hasTrip: Boolean = true,
        online: Boolean = true,
        onDraft: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AITripPostcardShareCardImageGenerationContent(
                    state = state,
                    hasTrip = hasTrip,
                    online = online,
                    onDraft = onDraft,
                )
            }
        }
    }

    @Test
    fun idleShowsTitleBadgeDescriptionAndAnEnabledAction() {
        setContent(state = TripImageDraftUiState.IDLE)

        compose.onNodeWithText("Draft a Helix share-card image").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("redacted trip context", substring = true).assertIsDisplayed()
        compose
            .onNodeWithText("Generate share card")
            .assertIsDisplayed()
            .assertHasClickAction()
            .assertIsEnabled()
    }

    @Test
    fun noTripShowsTheHintAndDisablesTheAction() {
        setContent(state = TripImageDraftUiState.IDLE, hasTrip = false)

        compose.onNodeWithText("Pick a trip from the list above to enable Helix.").assertIsDisplayed()
        compose.onNodeWithText("Generate share card").assertIsNotEnabled()
    }

    @Test
    fun streamingShowsTheThinkingIndicatorAndDisablesTheAction() {
        setContent(state = TripImageDraftUiState(phase = DraftPhase.Streaming))

        compose.onNodeWithText("Loading...").assertIsDisplayed()
        compose.onNodeWithText("Generate share card").assertIsNotEnabled()
    }

    @Test
    fun doneShowsTheProposedDraft() {
        setContent(
            state =
                TripImageDraftUiState(
                    phase = DraftPhase.Done,
                    draft = "Prompt: a minimalist sunrise drive postcard.",
                ),
        )

        compose.onNodeWithText("Prompt: a minimalist sunrise drive postcard.").assertIsDisplayed()
    }

    @Test
    fun doneWithNoDraftShowsAFriendlyEmptyState() {
        setContent(state = TripImageDraftUiState(phase = DraftPhase.Done))

        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun failedShowsTheErrorAndRetryInvokesOnDraft() {
        var retried = false
        setContent(
            state = TripImageDraftUiState(phase = DraftPhase.Failed, error = "stream_http_503"),
            onDraft = { retried = true },
        )

        compose.onNodeWithText("stream_http_503", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsTheOfflineChipAndDisablesTheAction() {
        setContent(state = TripImageDraftUiState.IDLE, online = false)

        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Generate share card").assertIsNotEnabled()
    }

    @Test
    fun theTitleIsExposedAsAHeadingForTalkBack() {
        setContent(state = TripImageDraftUiState.IDLE)

        compose
            .onNodeWithText("Draft a Helix share-card image")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }
}
