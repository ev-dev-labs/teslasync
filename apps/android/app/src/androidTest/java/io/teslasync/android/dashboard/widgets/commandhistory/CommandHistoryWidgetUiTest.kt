package io.teslasync.android.dashboard.widgets.commandhistory

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [CommandHistoryWidgetContent] across every state the
 * web component renders (loading skeleton, empty, hard error + retry, wide command feed, compact last
 * command, stale/offline cached). Asserts the rendered i18n strings and the TalkBack content descriptions
 * are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the logic; this covers the render.
 */
class CommandHistoryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun entry(
        command: String = "lock",
        status: String = "success",
    ): CommandLogEntry = CommandLogEntry(id = 1, command = command, status = status, createdAt = "2026-06-06T12:00:00Z")

    private fun setContent(
        state: UiState<List<CommandLogEntry>>,
        size: CommandHistorySize = CommandHistoryRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandHistoryWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = fixedNow,
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
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = fixedNow))
        compose.onNodeWithText("No commands sent").assertIsDisplayed()
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
    fun wideContentShowsTitleAndCommandRow() {
        setContent(UiState(UiPhase.Content, data = listOf(entry(command = "remote_start_drive")), fetchedAt = fixedNow))
        compose.onNodeWithText("Command History").assertIsDisplayed()
        // The command row exposes a single TalkBack phrase folding name + status + relative time.
        compose.onNodeWithContentDescription("Remote Start Drive", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactRowExposesNameAndStatusBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = listOf(entry(command = "lock", status = "success")), fetchedAt = fixedNow),
            size = CommandHistorySize(cols = 1, rows = 2),
        )
        // The compact row folds the command name + badge label into one accessible phrase.
        compose.onNodeWithContentDescription("Lock", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Success", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = listOf(entry(command = "unlock", status = "failed")),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Unlock", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = listOf(entry()), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
