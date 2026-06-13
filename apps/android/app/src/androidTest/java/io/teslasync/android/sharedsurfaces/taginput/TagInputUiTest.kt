package io.teslasync.android.sharedsurfaces.taginput

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TagInputContent] across every state the web component
 * renders plus the seed's lifecycle: the chips + field, the "No tags yet" empty hint, the loading skeleton,
 * the classified error + retry, the validator error text, the maxTags count + helper, and the stale / offline
 * freshness chips. Asserts the rendered i18n strings and the TalkBack content description on the chip remove
 * affordance. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the logic, this covers
 * the render.
 */
class TagInputUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        TagInputStrings(
            label = "Tags",
            fieldHint = "Add a tag\u2026",
            limitReachedGhost = "Tag limit reached",
            helperHint = "Press Enter to add",
            tagsNone = "No tags yet",
            resourceName = "Tags",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
        )

    private fun setContent(
        state: TagInputState,
        onRemoveAt: (Int) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TagInputContent(state = state, strings = strings, onRemoveAt = onRemoveAt, onRetry = onRetry)
            }
        }
    }

    @Test
    fun contentShowsChipsAndHelper() {
        setContent(TagInputState(phase = TagInputPhase.Content, tags = listOf("commute", "weekend")))
        compose.onNodeWithText("commute").assertIsDisplayed()
        compose.onNodeWithText("weekend").assertIsDisplayed()
        compose.onNodeWithText("Press Enter to add").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoTagsHint() {
        setContent(TagInputState(phase = TagInputPhase.Empty))
        compose.onNodeWithText("No tags yet").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(TagInputState(phase = TagInputPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            state = TagInputState(phase = TagInputPhase.Error, errorKind = ErrorKind.Http, httpStatus = 503),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun validationErrorIsShown() {
        setContent(
            TagInputState(
                phase = TagInputPhase.Content,
                tags = listOf("commute"),
                error = "Tags must be at least 2 characters",
            ),
        )
        compose.onNodeWithText("Tags must be at least 2 characters").assertIsDisplayed()
    }

    @Test
    fun atMaxShowsCountAndHelper() {
        setContent(TagInputState(phase = TagInputPhase.Content, tags = listOf("a", "b", "c"), maxTags = 3))
        compose.onNodeWithText("3/3").assertIsDisplayed()
        compose.onNodeWithText("Maximum 3 tags").assertIsDisplayed()
    }

    @Test
    fun staleShowsStaleChip() {
        setContent(TagInputState(phase = TagInputPhase.Content, tags = listOf("commute"), stale = true))
        compose.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun offlineShowsOfflineChip() {
        setContent(
            TagInputState(
                phase = TagInputPhase.Content,
                tags = listOf("commute"),
                offline = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun removeChipExposesAccessibleLabelAndInvokesRemoval() {
        var removed = -1
        setContent(
            state = TagInputState(phase = TagInputPhase.Content, tags = listOf("commute", "weekend")),
            onRemoveAt = { removed = it },
        )
        compose.onNodeWithContentDescription("Remove commute").assertIsDisplayed()
        compose.onNodeWithContentDescription("Remove commute").performClick()
        assertEquals(0, removed)
    }
}
