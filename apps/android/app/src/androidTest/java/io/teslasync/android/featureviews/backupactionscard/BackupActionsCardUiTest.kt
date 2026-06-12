package io.teslasync.android.featureviews.backupactionscard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [BackupActionsCardContent] across every surface the
 * web component implies: the loaded DefList rows + action row, the friendly empty affordance (run CTA still
 * available), the hard-error retry surface, the busy run button, the stale/offline cached view, and a raised
 * toast. Asserts the rendered i18n strings and the TalkBack labels on both action controls. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the projection + view-model.
 */
class BackupActionsCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        status: UiState<BackupStatus> = UiState(UiPhase.Content, data = SAMPLE),
        running: Boolean = false,
        toasts: List<ToastItem> = emptyList(),
        onRunBackup: () -> Unit = {},
        onManageBackups: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    BackupActionsCardContent(
                        status = status,
                        running = running,
                        onRunBackup = onRunBackup,
                        onManageBackups = onManageBackups,
                        onRetry = onRetry,
                        toasts = toasts,
                        onToastDismiss = {},
                    )
                }
            }
        }
    }

    @Test
    fun headerAndActionControlsAlwaysRender() {
        setContent()
        compose.onNodeWithText("Backup & Restore").assertIsDisplayed()
        // Both interactive controls carry a TalkBack label (accessibility-label presence).
        compose.onNodeWithContentDescription("Quick Backup").assertIsDisplayed()
        compose.onNodeWithContentDescription("Backup History").assertIsDisplayed()
    }

    @Test
    fun contentRowsRenderTheBackupStatus() {
        setContent()
        compose.onNodeWithText("Total Configs").assertIsDisplayed()
        compose.onNodeWithText("Total Backups").assertIsDisplayed()
        compose.onNodeWithText("Recent Errors").assertIsDisplayed()
        compose.onNodeWithText("14").assertIsDisplayed()
    }

    @Test
    fun runButtonInvokesCallback() {
        var ran = false
        setContent(onRunBackup = { ran = true })
        val node = compose.onNodeWithTag(BackupActionsCardProjection.RUN_BACKUP_TEST_TAG)
        node.assertHasClickAction()
        node.performClick()
        assertTrue(ran)
    }

    @Test
    fun manageButtonInvokesCallback() {
        var managed = false
        setContent(onManageBackups = { managed = true })
        compose.onNodeWithTag(BackupActionsCardProjection.MANAGE_BACKUPS_TEST_TAG).performClick()
        assertTrue(managed)
    }

    @Test
    fun emptyStateRendersWithRunCtaStillAvailable() {
        setContent(status = UiState(UiPhase.Empty, data = BackupStatus(0, 0, null, null, 0)))
        compose.onNodeWithText("No backup runs yet").assertIsDisplayed()
        // The run affordance stays available so the user can create the first backup.
        compose.onNodeWithTag(BackupActionsCardProjection.RUN_BACKUP_TEST_TAG).assertHasClickAction()
    }

    @Test
    fun errorStateRendersRetry() {
        var retried = false
        setContent(status = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun runningStateDisablesTheRunButton() {
        setContent(running = true)
        // Web parity: the button shows the pending label and is disabled while the mutation is in flight.
        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
        compose.onNodeWithTag(BackupActionsCardProjection.RUN_BACKUP_TEST_TAG).assertIsNotEnabled()
    }

    @Test
    fun offlineStateStillRendersTheCachedRows() {
        setContent(status = UiState(UiPhase.Content, data = SAMPLE, fetchedAt = 1L, stale = true, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Total Backups").assertIsDisplayed()
        compose.onNodeWithText("14").assertIsDisplayed()
    }

    @Test
    fun raisedToastMessageRenders() {
        setContent(toasts = listOf(ToastItem(id = 1L, message = "Quick backup started", tone = Tone.Success)))
        compose.onNodeWithText("Quick backup started").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 900.dp
        val SAMPLE =
            BackupStatus(
                configuredSchedules = 2,
                totalRuns = 14,
                lastSuccessfulAtMillis = null,
                lastSuccessfulSizeBytes = null,
                recentFailures = 1,
            )
    }
}
