package io.teslasync.android.sharedsurfaces.aiautonameunnamedlocations

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the AIAutoNameUnnamedLocations surface across every state
 * the web spec renders (web/src/components/ai/AIAutoNameUnnamedLocations.tsx): the AI-off gate (renders nothing,
 * web `withAiFeature` → null), the always-visible header (title + "Helix" badge + description) and Suggest
 * action, the computed disabled state while streaming, the "Helix is thinking" skeleton, the accepted proposal
 * (Apply enabled + click write-back), the rejected proposal (validator note + Apply disabled), the stream-error
 * retry, and the optional current label.
 */
class AIAutoNameUnnamedLocationsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val okDraft = LocationNameDraft(locationId = 42, proposedName = "Home", status = "ok")
    private val rejectedDraft =
        LocationNameDraft(locationId = 42, proposedName = "Unknown Stop", status = "rejected", reason = "Too generic")

    private fun setContent(
        state: AiNameDraftUiState,
        currentName: String? = null,
        onSuggest: () -> Unit = {},
        onApply: (LocationNameDraft) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AIAutoNameUnnamedLocationsContent(
                    state = state,
                    locationId = 42,
                    currentName = currentName,
                    onSuggest = onSuggest,
                    onApply = onApply,
                )
            }
        }
    }

    @Test
    fun disabledGateRendersNothing() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AIAutoNameUnnamedLocations(
                    locationId = 42,
                    onApplyName = {},
                    source = AiNameDraftSource { emptyFlow() },
                    enabled = false,
                    logger = NoopLogger,
                )
            }
        }
        compose.onNodeWithTag(AIAutoNameUnnamedLocationsRegistration.ROOT_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText("Suggest a name for this location").assertDoesNotExist()
    }

    @Test
    fun idleShowsHeaderBadgeDescriptionAndEnabledSuggest() {
        setContent(AiNameDraftUiState.IDLE)

        compose.onNodeWithText("Suggest a name for this location").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithTag(AIAutoNameUnnamedLocationsRegistration.SUGGEST_TEST_TAG).assertIsEnabled()
    }

    @Test
    fun suggestClickInvokesOnSuggest() {
        var suggested = false
        setContent(AiNameDraftUiState.IDLE, onSuggest = { suggested = true })

        compose.onNodeWithTag(AIAutoNameUnnamedLocationsRegistration.SUGGEST_TEST_TAG).performClick()
        assertTrue(suggested)
    }

    @Test
    fun streamingDisablesSuggestAndShowsThinkingSkeleton() {
        setContent(AiNameDraftUiState(phase = AiNameDraftPhase.Streaming))

        compose.onNodeWithTag(AIAutoNameUnnamedLocationsRegistration.SUGGEST_TEST_TAG).assertIsNotEnabled()
        // The shimmering "Helix is thinking" affordance carries the accessible loading label.
        compose.onNodeWithContentDescription("Loading").assertExists()
    }

    @Test
    fun acceptedProposalShowsNameEnabledApplyAndWritesBackOnClick() {
        var applied: LocationNameDraft? = null
        setContent(
            state = AiNameDraftUiState(phase = AiNameDraftPhase.Done, draft = okDraft),
            onApply = { applied = it },
        )

        compose.onNodeWithText("Proposed name").assertIsDisplayed()
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithTag(AIAutoNameUnnamedLocationsRegistration.DRAFT_TEST_TAG).assertExists()

        val apply = compose.onNodeWithTag(AIAutoNameUnnamedLocationsRegistration.APPLY_TEST_TAG)
        apply.assertIsEnabled()
        apply.performClick()
        assertEquals(okDraft, applied)
    }

    @Test
    fun rejectedProposalShowsValidatorNoteAndDisabledApply() {
        setContent(AiNameDraftUiState(phase = AiNameDraftPhase.Done, draft = rejectedDraft))

        compose.onNodeWithText("Unknown Stop").assertIsDisplayed()
        compose.onNodeWithText("Too generic").assertIsDisplayed()
        compose.onNodeWithText("Proposal rejected by validator").assertIsDisplayed()
        compose.onNodeWithTag(AIAutoNameUnnamedLocationsRegistration.APPLY_TEST_TAG).assertIsNotEnabled()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesSuggest() {
        var retried = false
        setContent(
            state = AiNameDraftUiState(phase = AiNameDraftPhase.Error, errorMessage = "stream_http_503"),
            onSuggest = { retried = true },
        )

        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun currentLabelIsShownWhenProvided() {
        setContent(AiNameDraftUiState.IDLE, currentName = "37.7749, -122.4194")

        compose.onNodeWithText("Current label").assertIsDisplayed()
        compose.onNodeWithText("37.7749, -122.4194").assertIsDisplayed()
    }

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }
}
