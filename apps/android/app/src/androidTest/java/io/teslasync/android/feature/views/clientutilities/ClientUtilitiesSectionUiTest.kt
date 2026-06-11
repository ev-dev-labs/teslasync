package io.teslasync.android.feature.views.clientutilities

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
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
 * Instrumented Compose UI + accessibility verification of [ClientUtilitiesSectionContent] across every
 * state the web component renders (loading skeleton chrome, the search box + expandable cards, the
 * "No tools match your search" filtered-empty state, the data-empty state, a hard error + retry, and the
 * stale/offline cached path). Asserts the rendered i18n strings, the card's expand-to-host behavior, and
 * the TalkBack labels (the card header is an accessible Button; the refresh control is named). Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection + adapter.
 */
class ClientUtilitiesSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<ClientUtilitiesSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ClientUtilitiesSectionContent(
                        state = state,
                        onRetry = onRetry,
                        toolContent = { id -> Text("TOOL_BODY_${id.slug}") },
                    )
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
    fun contentShowsSearchAndToolCards() {
        setContent(UiState(UiPhase.Content, data = ClientUtilitiesCatalog.snapshot, fetchedAt = NOW))
        compose.onNodeWithText("Search tools...").assertIsDisplayed()
        // The first tool's name resolves via the i18next key-fallback (no catalog entry upstream).
        compose.onNodeWithText("Vin Decoder").assertIsDisplayed()
        // Base64's name resolves through the shared catalog (P1/S10).
        compose.onNodeWithText("Base64").assertIsDisplayed()
    }

    @Test
    fun toolCardHeaderIsAnAccessibleButton() {
        setContent(UiState(UiPhase.Content, data = ClientUtilitiesCatalog.snapshot, fetchedAt = NOW))
        compose.onNodeWithText("Vin Decoder").assertHasClickAction()
    }

    @Test
    fun expandingACardRevealsItsHostedBody() {
        setContent(UiState(UiPhase.Content, data = ClientUtilitiesCatalog.snapshot, fetchedAt = NOW))
        compose.onNodeWithText("Vin Decoder").performClick()
        compose.onNodeWithText("TOOL_BODY_vin").assertIsDisplayed()
    }

    @Test
    fun searchWithNoMatchesShowsNoToolsFound() {
        setContent(UiState(UiPhase.Content, data = ClientUtilitiesCatalog.snapshot, fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).performTextInput("zzz-nothing")
        compose.onNodeWithText("No tools match your search").assertIsDisplayed()
    }

    @Test
    fun dataEmptyShowsNoToolsFound() {
        setContent(UiState(UiPhase.Empty, data = ClientUtilitiesSnapshot.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("No tools match your search").assertIsDisplayed()
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
    fun offlineKeepsCachedToolsVisibleWithRefresh() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = ClientUtilitiesCatalog.snapshot,
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached tools stay visible (never blanked) when offline/stale, and the refresh control is labelled.
        compose.onNodeWithText("Vin Decoder").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 720.dp
    }
}
