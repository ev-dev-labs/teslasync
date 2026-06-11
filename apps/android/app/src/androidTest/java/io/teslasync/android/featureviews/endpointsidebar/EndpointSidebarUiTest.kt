package io.teslasync.android.featureviews.endpointsidebar

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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [EndpointSidebarContent] across every state the
 * web component renders (loading skeleton chrome, the search box + endpoint count + collapsible tag groups
 * with colored method chips + paths, the search-empty + data-empty states, a hard error + retry, and the
 * stale/offline cached path). Asserts the rendered i18n strings, the search-driven filter, the row
 * selection callback, and the TalkBack labels (the loading region, the refresh control and the retry
 * affordance are all named; the search field exposes a set-text action; every row carries a verb+path
 * content description). Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers
 * the pure projection + adapter + state-holder logic.
 */
class EndpointSidebarUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<EndpointSidebarSnapshot>,
        selected: ParsedEndpoint? = null,
        onSelect: (ParsedEndpoint) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    EndpointSidebarContent(
                        state = state,
                        selected = selected,
                        onSelect = onSelect,
                        onRetry = onRetry,
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
    fun contentShowsSearchCountGroupsAndRows() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        // Search field label + the live endpoint count (web `{filtered.length} endpoints`).
        compose.onNodeWithText("Search endpoints...", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("5 endpoints", useUnmergedTree = true).assertIsDisplayed()
        // A group header (UPPER tag) + a method chip + a path row.
        compose.onNodeWithText("VEHICLES", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("GET", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("/vehicles", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun searchFiltersTheRows() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).performTextInput("charging")
        compose.onNodeWithText("/charging", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("1 endpoints", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun searchWithNoMatchesShowsFriendlyEmptyState() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).performTextInput("zzz-nothing")
        compose.onNodeWithText("No matching endpoints", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun dataEmptyShowsSearchAndFriendlyEmptyState() {
        setContent(UiState(UiPhase.Empty, data = EndpointSidebarSnapshot.EMPTY, fetchedAt = NOW))
        // The search box still renders; the list collapses to the friendly empty state, never a blank box.
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
        compose.onNodeWithText("No matching endpoints", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun tappingARowInvokesOnSelectWithThatEndpoint() {
        var picked: ParsedEndpoint? = null
        setContent(
            state = UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW),
            onSelect = { picked = it },
        )
        compose.onNodeWithContentDescription("GET /vehicles, List vehicles").performClick()
        assertEquals("/vehicles", picked?.path)
        assertEquals(HttpMethod.Get, picked?.method)
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
                data = snapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale, and the refresh control is labelled.
        compose.onNodeWithText("/vehicles", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun searchFieldExposesAnAccessibleTextAction() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun snapshot(): EndpointSidebarSnapshot =
        EndpointSidebarSnapshot(
            listOf(
                ParsedEndpoint(HttpMethod.Get, "/vehicles", "Vehicles", "List vehicles", operationId = "listVehicles"),
                ParsedEndpoint(HttpMethod.Get, "/vehicles/{vehicleID}/state", "Vehicles", "Vehicle state", operationId = "state"),
                ParsedEndpoint(HttpMethod.Post, "/vehicles/{vehicleID}/command", "Vehicles", "Send command", operationId = "cmd"),
                ParsedEndpoint(HttpMethod.Get, "/charging", "Charging", "List charging sessions", operationId = "listCharging"),
                ParsedEndpoint(HttpMethod.Delete, "/alerts/rules/{ruleID}", "Alerts", "Delete rule", operationId = "deleteRule"),
            ),
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 320.dp
        val HOST_HEIGHT = 900.dp
    }
}
