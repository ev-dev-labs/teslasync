package io.teslasync.android.sharedsurfaces.aisuggestnewgeofences

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
 * On-device Compose UI + accessibility verification of the AISuggestNewGeofences surface across every state the
 * web spec renders (web/src/components/ai/AISuggestNewGeofences.tsx): the AI-off gate (renders nothing, web
 * `withAiFeature` → null), the always-visible header (title + "Helix" badge + description) and Suggest action, the
 * computed disabled state while streaming, the "Helix is thinking" skeleton, the accepted proposal (name + rounded
 * radius + Apply enabled + click write-back), the rejected proposal (validator note + Apply disabled), the
 * stream-error retry, and the optional current label.
 */
class AISuggestNewGeofencesUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val okDraft =
        GeofenceDraft(
            locationId = 42,
            vehicleId = 7,
            proposedName = "Home",
            radiusM = 120.0,
            centroidLat = 37.5,
            centroidLon = -122.25,
            status = "ok",
        )
    private val rejectedDraft =
        GeofenceDraft(
            locationId = 42,
            vehicleId = 7,
            proposedName = "Unknown Stop",
            radiusM = 15.0,
            centroidLat = 37.5,
            centroidLon = -122.25,
            status = "invalid",
            validationError = "Radius below the 25 m minimum",
        )

    private fun setContent(
        state: AiGeofenceDraftUiState,
        currentName: String? = null,
        onSuggest: () -> Unit = {},
        onApply: (GeofenceDraft) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AISuggestNewGeofencesContent(
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
                AISuggestNewGeofences(
                    locationId = 42,
                    onApplyDraft = {},
                    source = AiGeofenceDraftSource { emptyFlow() },
                    enabled = false,
                    logger = NoopLogger,
                )
            }
        }
        compose.onNodeWithTag(AISuggestNewGeofencesRegistration.ROOT_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText("Suggest a geofence for this location").assertDoesNotExist()
    }

    @Test
    fun idleShowsHeaderBadgeDescriptionAndEnabledSuggest() {
        setContent(AiGeofenceDraftUiState.IDLE)

        compose.onNodeWithText("Suggest a geofence for this location").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithTag(AISuggestNewGeofencesRegistration.SUGGEST_TEST_TAG).assertIsEnabled()
    }

    @Test
    fun suggestClickInvokesOnSuggest() {
        var suggested = false
        setContent(AiGeofenceDraftUiState.IDLE, onSuggest = { suggested = true })

        compose.onNodeWithTag(AISuggestNewGeofencesRegistration.SUGGEST_TEST_TAG).performClick()
        assertTrue(suggested)
    }

    @Test
    fun streamingDisablesSuggestAndShowsThinkingSkeleton() {
        setContent(AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Streaming))

        compose.onNodeWithTag(AISuggestNewGeofencesRegistration.SUGGEST_TEST_TAG).assertIsNotEnabled()
        // The shimmering "Helix is thinking" affordance carries the accessible loading label.
        compose.onNodeWithContentDescription("Loading").assertExists()
    }

    @Test
    fun acceptedProposalShowsNameRadiusEnabledApplyAndWritesBackOnClick() {
        var applied: GeofenceDraft? = null
        setContent(
            state = AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Done, draft = okDraft),
            onApply = { applied = it },
        )

        compose.onNodeWithText("Proposed geofence").assertIsDisplayed()
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithText("Radius: 120 m").assertIsDisplayed()
        compose.onNodeWithTag(AISuggestNewGeofencesRegistration.DRAFT_TEST_TAG).assertExists()

        val apply = compose.onNodeWithTag(AISuggestNewGeofencesRegistration.APPLY_TEST_TAG)
        apply.assertIsEnabled()
        apply.performClick()
        assertEquals(okDraft, applied)
    }

    @Test
    fun rejectedProposalShowsValidatorNoteAndDisabledApply() {
        setContent(AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Done, draft = rejectedDraft))

        compose.onNodeWithText("Unknown Stop").assertIsDisplayed()
        compose.onNodeWithText("Radius below the 25 m minimum").assertIsDisplayed()
        compose.onNodeWithText("Proposal rejected by validator").assertIsDisplayed()
        compose.onNodeWithTag(AISuggestNewGeofencesRegistration.APPLY_TEST_TAG).assertIsNotEnabled()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesSuggest() {
        var retried = false
        setContent(
            state = AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Error, errorMessage = "stream_http_503"),
            onSuggest = { retried = true },
        )

        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun currentLabelIsShownWhenProvided() {
        setContent(AiGeofenceDraftUiState.IDLE, currentName = "37.7749, -122.4194")

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
