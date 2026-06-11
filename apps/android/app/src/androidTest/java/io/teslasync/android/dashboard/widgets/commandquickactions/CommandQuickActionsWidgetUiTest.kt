package io.teslasync.android.dashboard.widgets.commandquickactions

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [CommandQuickActionsWidgetContent] across every
 * state the web component renders (loading skeleton, empty "No vehicle selected", hard error + retry, the
 * command grid with per-command TalkBack labels, the in-flight disabled grid). Asserts the rendered i18n
 * strings, the per-button content descriptions, the tap callback, and the disable-while-running gate.
 * Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the logic, this
 * covers the render.
 */
class CommandQuickActionsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val withVehicle = CommandQuickActionsSnapshot(vehicleId = 7L)
    private val noVehicle = CommandQuickActionsSnapshot(vehicleId = 0L)

    private fun setContent(
        state: UiState<CommandQuickActionsSnapshot>,
        size: CommandQuickActionsSize = CommandQuickActionsRegistration.defaultSize,
        activeCommand: String? = null,
        onCommand: (String) -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandQuickActionsWidgetContent(
                    state = state,
                    size = size,
                    activeCommand = activeCommand,
                    onCommand = onCommand,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoVehicleMessage() {
        setContent(UiState(UiPhase.Empty, data = noVehicle, fetchedAt = 1L))
        compose.onNodeWithText("No vehicle selected").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentShowsTheSixDefaultCommandButtons() {
        setContent(UiState(UiPhase.Content, data = withVehicle, fetchedAt = 1L))
        compose.onNodeWithContentDescription("Lock").assertIsDisplayed()
        compose.onNodeWithContentDescription("Unlock").assertIsDisplayed()
        compose.onNodeWithContentDescription("Climate On").assertIsDisplayed()
        compose.onNodeWithContentDescription("Climate Off").assertIsDisplayed()
        compose.onNodeWithContentDescription("Frunk").assertIsDisplayed()
        compose.onNodeWithContentDescription("Horn").assertIsDisplayed()
    }

    @Test
    fun wideContentShowsAllEightCommands() {
        setContent(
            state = UiState(UiPhase.Content, data = withVehicle, fetchedAt = 1L),
            size = CommandQuickActionsSize(cols = 3, rows = 2),
        )
        // Trunk only appears in the full eight-command grid (web isWide slice).
        compose.onNodeWithContentDescription("Trunk").assertIsDisplayed()
        compose.onNodeWithContentDescription("Flash lights").assertIsDisplayed()
    }

    @Test
    fun tappingCommandButtonInvokesCallbackWithBackendAction() {
        var dispatched: String? = null
        setContent(
            state = UiState(UiPhase.Content, data = withVehicle, fetchedAt = 1L),
            onCommand = { dispatched = it },
        )
        compose.onNodeWithContentDescription("Frunk").performClick()
        assertEquals("actuate_frunk", dispatched)
    }

    @Test
    fun runningCommandDisablesEveryButton() {
        var dispatched: String? = null
        setContent(
            state = UiState(UiPhase.Content, data = withVehicle, fetchedAt = 1L),
            activeCommand = "lock",
            onCommand = { dispatched = it },
        )
        // Web `disabled={!!activeCommand}` — every button (including the running one) is disabled.
        compose.onNodeWithContentDescription("Lock").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Unlock").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Unlock").performClick()
        assertNull(dispatched)
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = withVehicle, fetchedAt = 1L))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
