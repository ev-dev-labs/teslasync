package io.teslasync.android.featureviews.uuidgenerator

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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [UuidGeneratorContent] across every state the web
 * tool renders (the always-present tool card + Generate button, the data-empty hint, the generating skeleton,
 * the generated list + copy, the error + retry, and the stale/offline cached path) plus the Generate-press
 * callback. Asserts the rendered i18n strings and the TalkBack labels (the Generate button is named and
 * clickable; copy/refresh controls are named; the skeleton is announced). Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the projection + adapter + view-model.
 */
class UuidGeneratorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<UuidBatch>,
        onGenerate: () -> Unit = {},
        onRetry: () -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    UuidGeneratorContent(state = state, onGenerate = onGenerate, onRetry = onRetry, onRefresh = onRefresh)
                }
            }
        }
    }

    @Test
    fun toolCardHeaderAndGenerateAlwaysRender() {
        setContent(UiState(UiPhase.Empty, data = UuidBatch.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("Uuid Generator").assertIsDisplayed()
        compose.onNodeWithText("Uuid Generator Desc").assertIsDisplayed()
        compose.onNodeWithText("Generate").assertIsDisplayed()
    }

    @Test
    fun emptyShowsAFriendlyHintNeverABlankBox() {
        setContent(UiState(UiPhase.Empty, data = UuidBatch.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAnAccessibleSkeleton() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun contentShowsTheGeneratedUuidAndACopyControl() {
        setContent(UiState(UiPhase.Content, data = UuidBatch(listOf(SAMPLE_UUID)), fetchedAt = NOW))
        compose.onNodeWithText(SAMPLE_UUID).assertIsDisplayed()
        compose.onNodeWithContentDescription("Copy").assertIsDisplayed()
    }

    @Test
    fun generateButtonIsAnAccessibleClickableControl() {
        var generated = false
        setContent(UiState(UiPhase.Empty, data = UuidBatch.EMPTY, fetchedAt = NOW), onGenerate = { generated = true })
        compose.onNodeWithText("Generate").assertHasClickAction()
        compose.onNodeWithText("Generate").performClick()
        assertTrue(generated)
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
                data = UuidBatch(listOf(SAMPLE_UUID)),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        compose.onNodeWithText(SAMPLE_UUID).assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        const val SAMPLE_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 720.dp
    }
}
