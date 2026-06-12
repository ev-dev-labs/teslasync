// Instrumented Compose UI + accessibility verification of [FSMStateDiagramContent] across every branch the
// web component renders (diagram / select-type empty) plus the lifecycle chrome the host's feed implies
// (loading / hard error with retry). Verifies the always-present heading, the per-state node labels, the
// diagram region's TalkBack label, and the "current state" marker's accessible label. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// projection + lifecycle classifier. `mainClock.autoAdvance` is disabled because the surface hosts
// indefinite animations (the loading skeleton shimmer + the current-state pulse) that never idle.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmstatediagram

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertExists
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

class FSMStateDiagramUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        FsmStateDiagramStrings(
            title = "State Diagram",
            selectFsmType = "Select a specific FSM type to view its state diagram",
        )

    private fun transitions(): List<FsmTransitionRow> =
        listOf(
            FsmTransitionRow("vehicle", "online", "driving", "2026-06-11T10:00:00Z"),
            FsmTransitionRow("vehicle", "driving", "parked", "2026-06-11T10:30:00Z"),
            FsmTransitionRow("vehicle", "parked", "charging", "2026-06-11T11:00:00Z"),
        )

    private fun setContent(
        fsmType: String,
        state: UiState<List<FsmTransitionRow>>,
        onRetry: () -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FSMStateDiagramContent(fsmType = fsmType, state = state, onRetry = onRetry, strings = strings)
                }
            }
        }
    }

    @Test
    fun headingIsAlwaysVisible() {
        setContent("vehicle", UiState(UiPhase.Content, data = transitions()))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun diagramShowsEveryStateNode() {
        setContent("vehicle", UiState(UiPhase.Content, data = transitions()))
        compose.onNodeWithText("online").assertIsDisplayed()
        compose.onNodeWithText("driving").assertIsDisplayed()
        compose.onNodeWithText("charging").assertIsDisplayed()
        compose.onNodeWithText("parked").assertIsDisplayed()
        compose.onNodeWithText("offline").assertIsDisplayed()
    }

    @Test
    fun diagramRegionExposesAccessibleLabel() {
        setContent("vehicle", UiState(UiPhase.Content, data = transitions()))
        compose.onNodeWithContentDescription(strings.title).assertIsDisplayed()
    }

    @Test
    fun currentStateMarkerExposesAccessibleLabel() {
        // The latest to_state (parked) renders the pulsing current-state marker with its own label.
        setContent("vehicle", UiState(UiPhase.Content, data = transitions()))
        compose.onNodeWithContentDescription("Current State").assertExists()
    }

    @Test
    fun unknownFsmTypeShowsSelectTypeEmptyState() {
        setContent("all", UiState(UiPhase.Content, data = emptyList()))
        compose.onNodeWithText(strings.selectFsmType).assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeleton() {
        setContent("vehicle", UiState.loading())
        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
    }

    @Test
    fun errorWithNoCacheShowsRetryAffordance() {
        var retried = false
        setContent(
            "vehicle",
            UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
