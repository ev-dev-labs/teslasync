package io.teslasync.android.featureviews.httpstatus

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [HttpStatusToolContent] across every state the
 * web component renders (loading skeleton chrome, the ToolCard header + search box + reference table, the
 * search-empty + data-empty states, a hard error + retry, and the stale/offline cached path). Asserts the
 * rendered i18n strings, the search-driven filter, and the TalkBack labels (the loading region, the
 * refresh control, and the retry affordance are all named; the search field exposes a set-text action).
 * Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection +
 * adapter + state-holder logic.
 */
class HttpStatusToolUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<HttpStatusSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    HttpStatusToolContent(state = state, onRetry = onRetry)
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun contentShowsToolCardHeaderSearchAndTable() {
        setContent(UiState(UiPhase.Content, data = HttpStatusCatalog.snapshot, fetchedAt = NOW))
        // ToolCard header (web `t('Http Status')` / `t('Http Status Desc')` — key-as-fallback).
        compose.onNodeWithText("Http Status").assertIsDisplayed()
        compose.onNodeWithText("Http Status Desc").assertIsDisplayed()
        // Search box label + the column headers.
        compose.onNodeWithText("Search Codes").assertIsDisplayed()
        compose.onNodeWithText("Status Code").assertIsDisplayed()
        compose.onNodeWithText("Status Text").assertIsDisplayed()
        // The first reference row.
        compose.onNodeWithText("200").assertIsDisplayed()
        compose.onNodeWithText("OK").assertIsDisplayed()
    }

    @Test
    fun searchFiltersTheReferenceRows() {
        setContent(UiState(UiPhase.Content, data = HttpStatusCatalog.snapshot, fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).performTextInput("timeout")
        // Only the two timeout rows survive (408 Request Timeout, 504 Gateway Timeout).
        compose.onNodeWithText("Request Timeout").assertIsDisplayed()
        compose.onNodeWithText("Gateway Timeout").assertIsDisplayed()
    }

    @Test
    fun searchWithNoMatchesShowsFriendlyEmptyState() {
        setContent(UiState(UiPhase.Content, data = HttpStatusCatalog.snapshot, fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).performTextInput("zzz-nothing")
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun dataEmptyShowsFriendlyEmptyState() {
        setContent(UiState(UiPhase.Empty, data = HttpStatusSnapshot.EMPTY, fetchedAt = NOW))
        // Header still renders; the body collapses to the friendly empty state, never a blank box.
        compose.onNodeWithText("Http Status").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedRowsVisibleWithLabelledRefresh() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = HttpStatusCatalog.snapshot,
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale, and the refresh control is labelled.
        compose.onNodeWithText("200").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun searchFieldExposesAnAccessibleTextAction() {
        setContent(UiState(UiPhase.Content, data = HttpStatusCatalog.snapshot, fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 900.dp
    }
}
