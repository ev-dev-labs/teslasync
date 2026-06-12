package io.teslasync.android.featureviews.advancedsettings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [AdvancedSettingsContent] across every state the
 * web panel renders (the always-present header + title/description, the friendly empty state, the first-read
 * skeleton, the silenced-prompt list + per-row restore, the "Restore all" affordance, the error + retry, and
 * the stale/offline cached path) plus the restore / restore-all / retry / refresh callbacks. Asserts the
 * rendered i18n strings and the TalkBack labels (each restore control is named by the prompt it re-enables;
 * the loading skeleton is announced; the refresh control is named). Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the projection + adapter + view-model.
 */
class AdvancedSettingsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<SilencedPrompts>,
        onRestore: (String) -> Unit = {},
        onRestoreAll: () -> Unit = {},
        onRetry: () -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    AdvancedSettingsContent(
                        state = state,
                        onRestore = onRestore,
                        onRestoreAll = onRestoreAll,
                        onRetry = onRetry,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    @Test
    fun headerTitleAndDescriptionAlwaysRender() {
        setContent(UiState(UiPhase.Empty, data = SilencedPrompts.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("Confirmation prompts").assertIsDisplayed()
        compose
            .onNodeWithText("Re-enable \u201CDon\u2019t ask again\u201D prompts you previously silenced.")
            .assertIsDisplayed()
    }

    @Test
    fun emptyShowsAFriendlyHintNeverABlankBox() {
        setContent(UiState(UiPhase.Empty, data = SilencedPrompts.EMPTY, fetchedAt = NOW))
        compose
            .onNodeWithText(
                "No silenced prompts. Tick \u201CDon\u2019t ask again\u201D on a confirmation dialog to silence it.",
            ).assertIsDisplayed()
    }

    @Test
    fun loadingShowsAnAccessibleSkeleton() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun contentShowsLabelledRowsAndRestoreControls() {
        setContent(UiState(UiPhase.Content, data = SAMPLE, fetchedAt = NOW))
        compose.onNodeWithText("Discard unsaved draft").assertIsDisplayed()
        compose.onNodeWithText("Leave page with unsaved changes").assertIsDisplayed()
        // Each restore control names the prompt it re-enables (TalkBack disambiguation).
        compose.onNodeWithContentDescription("Restore, Discard unsaved draft").assertIsDisplayed()
        compose.onNodeWithContentDescription("Restore, Leave page with unsaved changes").assertIsDisplayed()
    }

    @Test
    fun restoreRowIsAnAccessibleClickableControl() {
        var restored: String? = null
        setContent(UiState(UiPhase.Content, data = SAMPLE, fetchedAt = NOW), onRestore = { restored = it })
        val node = compose.onNodeWithContentDescription("Restore, Discard unsaved draft")
        node.assertHasClickAction()
        node.performClick()
        assertEquals("discard-draft", restored)
    }

    @Test
    fun restoreAllRendersWhenSilencedAndInvokesCallback() {
        var clearedAll = false
        setContent(UiState(UiPhase.Content, data = SAMPLE, fetchedAt = NOW), onRestoreAll = { clearedAll = true })
        compose.onNodeWithText("Restore all").assertHasClickAction()
        compose.onNodeWithText("Restore all").performClick()
        assertTrue(clearedAll)
    }

    @Test
    fun errorShowsServerErrorAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Unknown), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedListVisibleWithRefresh() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = SAMPLE,
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        compose.onNodeWithText("Discard unsaved draft").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val SAMPLE = SilencedPrompts.of(listOf("discard-draft", "unsaved-navigation"))
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 720.dp
    }
}
