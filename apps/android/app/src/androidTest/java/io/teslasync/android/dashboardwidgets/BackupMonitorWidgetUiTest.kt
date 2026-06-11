package io.teslasync.android.dashboardwidgets

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility tests for the Backup Monitor surface — the on-device
 * counterpart to the no-device [BackupMonitorWidgetTest]. They render [BackupMonitorWidgetContent]
 * in each state/footprint and assert the right branch shows, that interactive elements carry TalkBack
 * names, and that the retry/refresh affordances fire. Runs under `connectedReleaseAndroidTest`.
 */
class BackupMonitorWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun loadingState_showsSkeletonChrome() {
        rule.setContent {
            TeslaSyncTheme {
                BackupMonitorWidgetContent(
                    state = BackupMonitorUiState.LOADING,
                    size = BackupMonitorRegistration.defaultSize,
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithTag(BackupMonitorTags.LOADING).assertIsDisplayed()
    }

    @Test
    fun emptyState_showsNoBackupDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                BackupMonitorWidgetContent(
                    state = emptyState(),
                    size = BackupMonitorRegistration.defaultSize,
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithTag(BackupMonitorTags.EMPTY).assertIsDisplayed()
        rule.onNodeWithText("No backup data").assertIsDisplayed()
    }

    @Test
    fun errorState_showsRetryAndFiresCallback() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                BackupMonitorWidgetContent(
                    state = errorState(),
                    size = BackupMonitorRegistration.defaultSize,
                    onRetry = { retried = true },
                )
            }
        }
        rule.onNodeWithTag(BackupMonitorTags.ERROR).assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardState_showsStatGridAndStatusBadge() {
        rule.setContent {
            TeslaSyncTheme {
                BackupMonitorWidgetContent(
                    state = contentState(),
                    size = BackupMonitorRegistration.defaultSize,
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithTag(BackupMonitorTags.STAT_GRID).assertIsDisplayed()
        rule.onNodeWithText("Last backup").assertIsDisplayed()
        rule.onNodeWithText("1h ago").assertIsDisplayed()
        // completed → Success badge (web statusLabel).
        assertTrue(rule.onAllNodesWithText("Success").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun wideState_showsRecentRunsFeed() {
        rule.setContent {
            TeslaSyncTheme {
                BackupMonitorWidgetContent(
                    state = contentState(),
                    size = BackupMonitorSize(cols = 4, rows = 6),
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithTag(BackupMonitorTags.RECENT_RUNS).assertIsDisplayed()
        rule.onNodeWithText("Recent Runs").assertIsDisplayed()
    }

    @Test
    fun compactState_showsStatusLineWithAccessibleName() {
        rule.setContent {
            TeslaSyncTheme {
                BackupMonitorWidgetContent(
                    state = contentState(),
                    size = BackupMonitorSize(cols = 1, rows = 2),
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithTag(BackupMonitorTags.COMPACT).assertIsDisplayed()
        // Merged TalkBack name on the compact line (label + relative time + status).
        assertTrue(
            rule.onAllNodesWithText("Last backup", substring = true).fetchSemanticsNodes().isNotEmpty(),
        )
    }

    @Test
    fun refreshButton_hasAccessibleNameAndFiresCallback() {
        var refreshed = false
        rule.setContent {
            TeslaSyncTheme {
                BackupMonitorWidgetContent(
                    state = contentState(),
                    size = BackupMonitorRegistration.defaultSize,
                    onRetry = { refreshed = true },
                )
            }
        }
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        rule.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    // ── state fixtures ───────────────────────────────────────────────────────────────────────────

    private fun contentDisplay(): BackupMonitorDisplay {
        val runs =
            (1..6).map { index ->
                BackupRun(
                    id = index.toLong(),
                    status = "completed",
                    backupType = "full",
                    fileSizeBytes = 1024.0 * index,
                    createdAt = null,
                    completedAt = "2024-01-0${index}T00:00:00Z",
                    durationMs = 100L * index,
                )
            }
        return BackupMonitorProjection.project(BackupMonitorSnapshot(runs), nowMillis = LATEST_PLUS_HOUR) { "run-time" }
    }

    private fun contentState(): BackupMonitorUiState =
        BackupMonitorUiState(
            phase = UiPhase.Content,
            display = contentDisplay(),
            updatedAtMillis = LATEST_PLUS_HOUR,
            refreshing = false,
            stale = false,
            errorKind = null,
            errorStatus = null,
        )

    private fun emptyState(): BackupMonitorUiState =
        BackupMonitorUiState(
            phase = UiPhase.Empty,
            display = BackupMonitorDisplay.EMPTY,
            updatedAtMillis = LATEST_PLUS_HOUR,
            refreshing = false,
            stale = false,
            errorKind = null,
            errorStatus = null,
        )

    private fun errorState(): BackupMonitorUiState =
        BackupMonitorUiState(
            phase = UiPhase.Error,
            display = BackupMonitorDisplay.EMPTY,
            updatedAtMillis = null,
            refreshing = false,
            stale = false,
            errorKind = ErrorKind.Http,
            errorStatus = 500,
        )

    private companion object {
        // 2024-01-06T01:00:00Z — one hour after the newest fixture run (id 6), so its relative time is "1h ago".
        const val LATEST_PLUS_HOUR = 1_704_502_800_000L
    }
}
