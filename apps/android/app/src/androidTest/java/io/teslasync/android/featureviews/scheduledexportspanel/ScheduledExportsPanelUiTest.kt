package io.teslasync.android.featureviews.scheduledexportspanel

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportDelivery
import io.teslasync.shared.core.presentation.exports.ScheduledExportInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ScheduledExportsPanel surface across every state it
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-schedules empty state, the populated
 * rows (every web table column — name, type+format, cron, delivery, run status — with labelled Run-now /
 * Enable-Disable / Edit / Delete actions), the stale/offline cached view + auto-refresh, and the inline create form
 * opened from the New-schedule affordance. The offline gate's `testReleaseUnitTest` covers the pure logic +
 * view-model; this covers render + a11y. Mirrors the web spec (web/src/features/system/pages/ScheduledExportsPanel.tsx).
 */
class ScheduledExportsPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun schedules(): List<ScheduledExport> =
        listOf(
            ScheduledExport(
                id = 1,
                name = "Drives weekly",
                exportType = "drives",
                format = "csv",
                scheduleCron = "0 9 * * 0",
                delivery = ScheduledExportDelivery(kind = "email", target = "ops@example.com"),
                rangeWindow = "7d",
                enabled = true,
                lastStatus = "ok",
                lastRunAt = "2024-04-04T09:00:00Z",
                nextRunAt = "2024-04-11T09:00:00Z",
            ),
            ScheduledExport(
                id = 2,
                name = "Charging monthly",
                exportType = "charging",
                format = "json",
                scheduleCron = "0 0 1 * *",
                delivery = ScheduledExportDelivery(kind = "download"),
                rangeWindow = "30d",
                enabled = false,
                lastStatus = "failed",
            ),
        )

    private fun setContent(
        schedulesState: UiState<List<ScheduledExport>>,
        runningNowId: Long? = null,
        onRunNow: (ScheduledExport) -> Unit = {},
        onToggle: (ScheduledExport) -> Unit = {},
        onEdit: (ScheduledExport) -> Unit = {},
        onDelete: (ScheduledExport) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScheduledExportsPanelContent(
                    schedulesState = schedulesState,
                    runningNowId = runningNowId,
                    showForm = false,
                    form = emptyScheduledExportForm(),
                    saving = false,
                    onNew = {},
                    onFormChange = {},
                    onCancelForm = {},
                    onSubmit = {},
                    onRunNow = onRunNow,
                    onToggle = onToggle,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun loadingShowsNewScheduleAffordanceAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onAllNodesWithText("New schedule").onFirst().assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Loading...").onFirst().assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            schedulesState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoSchedulesMessageWithCta() {
        setContent(UiState(UiPhase.Empty, emptyList()))
        compose.onNodeWithText("No schedules yet").assertIsDisplayed()
        compose.onNodeWithText("Create a schedule to receive recurring exports automatically.").assertIsDisplayed()
    }

    @Test
    fun contentRendersEveryColumnBadgesAndAccessibleActions() {
        setContent(schedulesState = UiState(UiPhase.Content, schedules()))
        // Rows.
        compose.onNodeWithText("Drives weekly").assertIsDisplayed()
        compose.onNodeWithText("Charging monthly").assertIsDisplayed()
        // Type (format), cron, delivery cells.
        compose.onNodeWithText("drives (csv)").assertIsDisplayed()
        compose.onAllNodesWithText("0 9 * * 0").onFirst().assertIsDisplayed()
        compose.onNodeWithText("email \u2192 ops@example.com").assertIsDisplayed()
        // Run-status badges.
        compose.onNodeWithText("OK").assertIsDisplayed()
        compose.onNodeWithText("Failed").assertIsDisplayed()
        // Accessible, labelled actions (the text is the TalkBack label for a text button).
        compose.onAllNodesWithText("Run now").onFirst().assertIsDisplayed()
        compose.onNodeWithText("Disable").assertIsDisplayed()
        compose.onNodeWithText("Enable").assertIsDisplayed()
        compose.onAllNodesWithText("Edit").onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("Delete").onFirst().assertIsDisplayed()
    }

    @Test
    fun rowActionsInvokeCallbacks() {
        var ran: Long? = null
        var edited: Long? = null
        var deleted: Long? = null
        val single =
            listOf(
                ScheduledExport(
                    id = 9,
                    name = "Solo",
                    exportType = "drives",
                    format = "csv",
                    scheduleCron = "0 9 * * 0",
                    delivery = ScheduledExportDelivery(kind = "download"),
                    rangeWindow = "7d",
                    enabled = true,
                ),
            )
        setContent(
            schedulesState = UiState(UiPhase.Content, single),
            onRunNow = { ran = it.id },
            onEdit = { edited = it.id },
            onDelete = { deleted = it.id },
        )
        compose.onNodeWithText("Run now").performClick()
        compose.onNodeWithText("Edit").performClick()
        compose.onNodeWithText("Delete").performClick()
        assertTrue(ran == 9L && edited == 9L && deleted == 9L)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            schedulesState =
                UiState(
                    phase = UiPhase.Content,
                    data = schedules(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.onNodeWithText("Drives weekly").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            schedulesState =
                UiState(
                    phase = UiPhase.Content,
                    data = schedules(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Drives weekly").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun newScheduleAffordanceOpensInlineFormWithFields() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                val vm =
                    remember {
                        ScheduledExportsPanelViewModel(
                            source = FakeUiSource(),
                            logger = SilentLogger,
                            scope = null,
                        )
                    }
                ScheduledExportsPanel(viewModel = vm)
            }
        }
        compose.onAllNodesWithText("New schedule").onFirst().performClick()
        // The inline create form: the non-required field labels + the submit affordance.
        compose.onNodeWithText("Export type").assertIsDisplayed()
        compose.onNodeWithText("Range window").assertIsDisplayed()
        compose.onNodeWithText("Save schedule").assertIsDisplayed()
    }

    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeUiSource : ScheduledExportsPanelSource {
        override fun scheduledExports(): Flow<Resource<List<ScheduledExport>>> = flowOf(Resource.Success(emptyList(), 1L, false))

        override fun invalidate() = Unit

        override suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport> =
            Result.success(ScheduledExport(id = 1))

        override suspend fun updateScheduledExport(
            id: Long,
            input: ScheduledExportInput,
        ): Result<ScheduledExport> = Result.success(ScheduledExport(id = id))

        override suspend fun deleteScheduledExport(id: Long): Result<Unit> = Result.success(Unit)

        override suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport> = Result.success(ScheduledExport(id = id))
    }
}
