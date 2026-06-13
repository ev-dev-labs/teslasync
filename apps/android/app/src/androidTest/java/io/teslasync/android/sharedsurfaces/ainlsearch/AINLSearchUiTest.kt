package io.teslasync.android.sharedsurfaces.ainlsearch

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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device UI + accessibility verification of the AINLSearch stateless renderer — proves every lifecycle state
 * of the web card (web/src/components/ai/AINLSearch.tsx) renders with the right chrome and a11y affordances: the
 * always-present title + Helix badge + description + query input, the idle/streaming/done/empty/error output,
 * the offline chip, and that the action + retry expose click actions, the title is a heading, and the query
 * input carries a TalkBack content description. Runs on a device/emulator via `:android:connectedAndroidTest`.
 */
class AINLSearchUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val exampleHint = "e.g. drives last weekend over 200 km with phantom drain"

    private fun setContent(
        state: NlSearchUiState,
        prompt: String = "drives over 200 km",
        canStart: Boolean = true,
        online: Boolean = true,
        onSearch: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AINLSearchContent(
                    state = state,
                    prompt = prompt,
                    canStart = canStart,
                    online = online,
                    onPromptChange = {},
                    onSearch = onSearch,
                )
            }
        }
    }

    @Test
    fun idleShowsTitleBadgeDescriptionAndQueryInput() {
        setContent(state = NlSearchUiState.IDLE, prompt = "", canStart = false)

        compose.onNodeWithText("Search with natural language").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("Describe what you are looking for", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("phantom drain", substring = true).assertIsDisplayed()
    }

    @Test
    fun aReadyQueryEnablesTheAction() {
        setContent(state = NlSearchUiState.IDLE, prompt = "drives over 200 km", canStart = true)

        compose
            .onNodeWithText("Search with Helix")
            .assertIsDisplayed()
            .assertHasClickAction()
            .assertIsEnabled()
    }

    @Test
    fun streamingShowsTheThinkingPlaceholderAndDisablesTheAction() {
        setContent(state = NlSearchUiState(phase = SearchPhase.Streaming))

        compose.onNodeWithText("Loading...").assertIsDisplayed()
        compose.onNodeWithText("Search with Helix").assertIsNotEnabled()
    }

    @Test
    fun doneShowsTheNarratedAnswer() {
        setContent(
            state = NlSearchUiState(phase = SearchPhase.Done, results = "Found 2 drives: Coast Run and Cabin Trip."),
        )

        compose.onNodeWithText("Found 2 drives: Coast Run and Cabin Trip.").assertIsDisplayed()
    }

    @Test
    fun doneWithNoAnswerShowsTheEmptyState() {
        setContent(state = NlSearchUiState(phase = SearchPhase.Done))

        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun failedShowsTheErrorAndRetryInvokesOnSearch() {
        var retried = false
        setContent(
            state = NlSearchUiState(phase = SearchPhase.Failed, error = "stream_http_503"),
            onSearch = { retried = true },
        )

        compose.onNodeWithText("stream_http_503", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsTheOfflineChipAndDisablesTheAction() {
        setContent(state = NlSearchUiState.IDLE, canStart = false, online = false)

        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Search with Helix").assertIsNotEnabled()
    }

    @Test
    fun theTitleIsExposedAsAHeadingForTalkBack() {
        setContent(state = NlSearchUiState.IDLE)

        compose
            .onNodeWithText("Search with natural language")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    @Test
    fun theQueryInputExposesAContentDescriptionForTalkBack() {
        setContent(state = NlSearchUiState.IDLE, prompt = "")

        compose.onNodeWithContentDescription(exampleHint).assertIsDisplayed()
    }
}
