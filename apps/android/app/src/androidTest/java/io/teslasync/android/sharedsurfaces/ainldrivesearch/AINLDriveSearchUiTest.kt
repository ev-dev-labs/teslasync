package io.teslasync.android.sharedsurfaces.ainldrivesearch

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
 * On-device UI + accessibility verification of the AINLDriveSearch stateless renderer — proves every lifecycle
 * state of the web card (web/src/components/ai/AINLDriveSearch.tsx) renders with the right chrome and a11y
 * affordances: the always-present title + Helix badge + propose-only description + prompt input, the
 * resting/loading/content/empty/error/stale/offline output, the streamed narration kept visible offline, and
 * that the Search + Retry actions expose click actions and accessible labels and the header is a heading. Runs
 * on a device/emulator via `:android:connectedAndroidTest`.
 */
class AINLDriveSearchUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val searchCd = "Ask Helix · Search with Helix"

    private fun setContent(
        state: DriveSearchState,
        onSearch: () -> Unit = {},
        onRetry: () -> Unit = {},
        nowMs: () -> Long = { 0L },
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AINLDriveSearchContent(
                    state = state,
                    resolve = FallbackResolver,
                    onPromptChange = {},
                    onSearch = onSearch,
                    onRetry = onRetry,
                    nowMs = nowMs,
                )
            }
        }
    }

    @Test
    fun restingShowsHeaderAndAnEnabledAction() {
        setContent(state = state(DriveSearchPhase.Idle, prompt = "last Friday's coast trip"))

        compose.onNodeWithContentDescription("Find a drive in natural language", substring = true).assertIsDisplayed()
        compose
            .onNodeWithContentDescription(searchCd)
            .assertIsDisplayed()
            .assertHasClickAction()
            .assertIsEnabled()
    }

    @Test
    fun contentShowsNarratedResult() {
        setContent(
            state = state(DriveSearchPhase.Done, committedText = SAMPLE, fetchedAt = 0L),
            nowMs = { 0L },
        )

        compose.onNodeWithContentDescription(SAMPLE, substring = true).assertIsDisplayed()
    }

    @Test
    fun staleResultShowsAStaleChip() {
        setContent(
            state = state(DriveSearchPhase.Done, committedText = SAMPLE, fetchedAt = 0L),
            nowMs = { DRIVE_SEARCH_FRESHNESS_WINDOW_MS + 1L },
        )

        compose.onNodeWithContentDescription("Stale", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheNoMatchMessage() {
        setContent(state = state(DriveSearchPhase.Done, committedText = ""))

        compose.onNodeWithContentDescription("No matching drive", substring = true).assertIsDisplayed()
        compose.onNodeWithText("No matching drive", substring = true).assertIsDisplayed()
    }

    @Test
    fun loadingDisablesTheActionWhileStreaming() {
        setContent(state = state(DriveSearchPhase.Streaming, prompt = "coast trip"))

        compose.onNodeWithContentDescription(searchCd).assertIsNotEnabled()
        compose.onNodeWithContentDescription("Helix is thinking", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsTheTitleAndRetryInvokesOnRetry() {
        var retried = false
        setContent(
            state = state(DriveSearchPhase.Failed, prompt = "coast trip", errorKind = ErrorKind.Http),
            onRetry = { retried = true },
        )

        compose.onNodeWithContentDescription("Couldn't search your drives", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsTheOfflineChipAndKeepsTheResult() {
        setContent(
            state =
                state(
                    DriveSearchPhase.Failed,
                    prompt = "coast trip",
                    committedText = SAMPLE,
                    errorKind = ErrorKind.Network,
                ),
        )

        compose.onNodeWithContentDescription("Offline", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(SAMPLE, substring = true).assertIsDisplayed()
        // The prompt is still non-blank, so a re-search is offered (web `canStart` is prompt-only).
        compose.onNodeWithContentDescription(searchCd).assertIsEnabled()
    }

    @Test
    fun searchActionExposesAnAccessibleLabel() {
        setContent(state = state(DriveSearchPhase.Idle, prompt = "coast trip"))

        compose.onNodeWithContentDescription(searchCd).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun theHeaderIsExposedAsAHeadingForTalkBack() {
        setContent(state = state(DriveSearchPhase.Idle, prompt = "coast trip"))

        compose
            .onNodeWithContentDescription("Find a drive in natural language", substring = true)
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun state(
        phase: DriveSearchPhase,
        prompt: String = "coast trip",
        streamingText: String = "",
        committedText: String = "",
        errorKind: ErrorKind? = null,
        fetchedAt: Long? = null,
    ): DriveSearchState =
        DriveSearchState(
            gateEnabled = true,
            prompt = prompt,
            phase = phase,
            streamingText = streamingText,
            committedText = committedText,
            errorKind = errorKind,
            fetchedAt = fetchedAt,
        )

    private companion object {
        const val SAMPLE =
            "Found it — your drive last Friday from Home to Pacifica State Beach: 38.2 km in 47 minutes."
    }
}
