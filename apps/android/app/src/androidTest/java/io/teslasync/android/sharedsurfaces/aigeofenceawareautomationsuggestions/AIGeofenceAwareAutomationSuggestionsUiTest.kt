package io.teslasync.android.sharedsurfaces.aigeofenceawareautomationsuggestions

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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device UI + accessibility verification of the AIGeofenceAwareAutomationSuggestions stateless renderer —
 * proves every lifecycle state of the web card (web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx)
 * renders with the right chrome and a11y affordances: the always-present title + Helix badge + propose-only
 * description + prompt input, the empty/loading/content/error/offline output, the captured automation graph with
 * its counts, the validator-rejected notice with a disabled Apply, and that the action + Apply + retry expose
 * click actions and accessible labels and the title is a heading. Runs on a device/emulator via
 * `:android:connectedAndroidTest`.
 */
class AIGeofenceAwareAutomationSuggestionsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val suggestCd = "Ask Helix · Suggest automation"

    private fun setContent(
        snapshot: GeofenceDraftSnapshot,
        prompt: String = "",
        onSuggest: () -> Unit = {},
        onRetry: () -> Unit = {},
        onApply: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AIGeofenceAwareAutomationSuggestionsContent(
                    snapshot = snapshot,
                    prompt = prompt,
                    resolve = FallbackResolver,
                    onPromptChange = {},
                    onSuggest = onSuggest,
                    onRetry = onRetry,
                    onApply = onApply,
                )
            }
        }
    }

    @Test
    fun emptyShowsTitleBadgeDescriptionAndAnEnabledAction() {
        setContent(snapshot = snapshot(GeofenceDraftRenderState.Empty))

        compose.onNodeWithText("Suggest a geofence-aware automation").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("Helix proposes a typed graph", substring = true).assertIsDisplayed()
        compose.onNodeWithText("No proposal yet", substring = true).assertIsDisplayed()
        compose
            .onNodeWithText("Ask Helix")
            .assertIsDisplayed()
            .assertHasClickAction()
            .assertIsEnabled()
    }

    @Test
    fun contentShowsProposedAutomationNameCountsAndEnabledApply() {
        setContent(
            snapshot = snapshot(GeofenceDraftRenderState.Content, proposal = proposal(), phase = AiStreamPhase.Done),
        )

        compose.onNodeWithText("Proposed automation").assertIsDisplayed()
        compose.onNodeWithText("Home protection").assertIsDisplayed()
        compose.onNodeWithText("Triggers: 2", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Conditions: 1", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Apply to form").assertHasClickAction().assertIsEnabled()
    }

    @Test
    fun rejectedProposalShowsValidatorNoticeAndDisablesApply() {
        setContent(
            snapshot =
                snapshot(
                    GeofenceDraftRenderState.Content,
                    proposal = proposal(status = "invalid"),
                    phase = AiStreamPhase.Done,
                ),
        )

        compose.onNodeWithText("Proposal rejected by validator").assertIsDisplayed()
        compose.onNodeWithText("place_id not found", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Apply to form").assertIsNotEnabled()
    }

    @Test
    fun applyInvokesCallbackForAcceptedGraph() {
        var applied = false
        setContent(
            snapshot = snapshot(GeofenceDraftRenderState.Content, proposal = proposal(), phase = AiStreamPhase.Done),
            onApply = { applied = true },
        )

        compose.onNodeWithContentDescription("Apply to form").performClick()
        assertTrue(applied)
    }

    @Test
    fun loadingDisablesTheActionWhileStreaming() {
        setContent(snapshot = snapshot(GeofenceDraftRenderState.Loading, phase = AiStreamPhase.Streaming))

        compose.onNodeWithContentDescription(suggestCd).assertIsNotEnabled()
    }

    @Test
    fun errorShowsTheMessageAndRetryInvokesOnSuggest() {
        var retried = false
        setContent(
            snapshot =
                snapshot(
                    GeofenceDraftRenderState.Error,
                    phase = AiStreamPhase.Error,
                    errorMessage = "stream_http_503",
                    canStart = true,
                ),
            onRetry = { retried = true },
        )

        compose.onNodeWithText("stream_http_503", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsTheOfflineNoticeKeepsTheGraphAndDisablesTheAction() {
        setContent(
            snapshot = snapshot(GeofenceDraftRenderState.Offline, proposal = proposal(), canStart = false),
        )

        compose.onNodeWithText("You're offline", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Home protection").assertIsDisplayed()
        compose.onNodeWithContentDescription(suggestCd).assertIsNotEnabled()
    }

    @Test
    fun suggestActionExposesAnAccessibleLabel() {
        setContent(snapshot = snapshot(GeofenceDraftRenderState.Empty))

        compose.onNodeWithContentDescription(suggestCd).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun theTitleIsExposedAsAHeadingForTalkBack() {
        setContent(snapshot = snapshot(GeofenceDraftRenderState.Empty))

        compose
            .onNodeWithText("Suggest a geofence-aware automation")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    @Suppress("LongParameterList")
    private fun snapshot(
        renderState: GeofenceDraftRenderState,
        proposal: AutomationProposal? = null,
        phase: AiStreamPhase = AiStreamPhase.Idle,
        streamedText: String = "",
        canStart: Boolean = true,
        errorMessage: String? = null,
        limit: AiLimitInfo? = null,
    ): GeofenceDraftSnapshot =
        GeofenceDraftSnapshot(
            renderState = renderState,
            phase = phase,
            proposal = proposal,
            streamedText = streamedText,
            canStart = canStart,
            isBusy = phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm,
            errorMessage = errorMessage,
            limit = limit,
            offline = renderState == GeofenceDraftRenderState.Offline,
            stale = renderState == GeofenceDraftRenderState.Stale,
        )

    private fun proposal(
        status: String = "ok",
        triggers: Int = 2,
        conditions: Int = 1,
        actions: Int = 3,
    ): AutomationProposal =
        AutomationProposal(
            graph =
                AutomationGraphDraft(
                    name = "Home protection",
                    description = "Cabin overheat protection at Home after sunset",
                    vehicleId = 7L,
                    enabled = true,
                    triggers = nodes(triggers),
                    conditions = nodes(conditions),
                    actions = nodes(actions),
                ),
            status = status,
            validationError = if (status == "ok") null else "place_id not found in your geofence catalog",
        )

    private fun nodes(count: Int): List<JsonElement> = List(count) { JsonNull }
}
