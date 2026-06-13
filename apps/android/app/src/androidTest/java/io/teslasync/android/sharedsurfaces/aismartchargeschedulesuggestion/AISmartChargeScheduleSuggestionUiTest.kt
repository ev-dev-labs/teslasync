package io.teslasync.android.sharedsurfaces.aismartchargeschedulesuggestion

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
 * On-device UI + accessibility verification of the AISmartChargeScheduleSuggestion stateless renderer — proves
 * every lifecycle state of the web card (web/src/components/ai/AISmartChargeScheduleSuggestion.tsx) renders with
 * the right chrome and a11y affordances: the always-present title + Helix badge + propose-only description, the
 * idle/streaming/done/empty/error output, the offline chip, and that the action + retry expose click actions and
 * the title is a heading. Runs on a device/emulator via `:android:connectedAndroidTest`.
 */
class AISmartChargeScheduleSuggestionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: ScheduleDraftUiState,
        canStart: Boolean = true,
        online: Boolean = true,
        onDraft: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AISmartChargeScheduleSuggestionContent(
                    state = state,
                    canStart = canStart,
                    online = online,
                    onDraft = onDraft,
                )
            }
        }
    }

    @Test
    fun idleShowsTitleBadgeDescriptionAndAnEnabledAction() {
        setContent(state = ScheduleDraftUiState.IDLE)

        compose.onNodeWithText("Draft a schedule with Helix").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("time-of-use-optimized", substring = true).assertIsDisplayed()
        compose
            .onNodeWithText("Draft a schedule")
            .assertIsDisplayed()
            .assertHasClickAction()
            .assertIsEnabled()
    }

    @Test
    fun streamingShowsTheThinkingPlaceholderAndDisablesTheAction() {
        setContent(state = ScheduleDraftUiState(phase = SchedulePhase.Streaming))

        compose.onNodeWithText("Loading...").assertIsDisplayed()
        compose.onNodeWithText("Draft a schedule").assertIsNotEnabled()
    }

    @Test
    fun doneShowsTheProposedSchedule() {
        setContent(
            state =
                ScheduleDraftUiState(
                    phase = SchedulePhase.Done,
                    schedule = "Charge 01:00–05:30 on the off-peak window.",
                ),
        )

        compose.onNodeWithText("Charge 01:00–05:30 on the off-peak window.").assertIsDisplayed()
    }

    @Test
    fun doneWithNoScheduleShowsAFriendlyEmptyState() {
        setContent(state = ScheduleDraftUiState(phase = SchedulePhase.Done))

        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun failedShowsTheErrorAndRetryInvokesOnDraft() {
        var retried = false
        setContent(
            state = ScheduleDraftUiState(phase = SchedulePhase.Failed, error = "stream_http_503"),
            onDraft = { retried = true },
        )

        compose.onNodeWithText("stream_http_503", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsTheOfflineChipAndDisablesTheAction() {
        setContent(state = ScheduleDraftUiState.IDLE, canStart = false, online = false)

        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Draft a schedule").assertIsNotEnabled()
    }

    @Test
    fun theTitleIsExposedAsAHeadingForTalkBack() {
        setContent(state = ScheduleDraftUiState.IDLE)

        compose
            .onNodeWithText("Draft a schedule with Helix")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }
}
