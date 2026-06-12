package io.teslasync.android.featureviews.backupactionscard

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Drives [BackupActionsCardViewModel] over a controllable [InMemoryBackupActionsCardSource], covering the
 * quick-backup mutation (run → success/permission/generic toast, the web `onError` 401/403-vs-generic branch),
 * the in-flight [BackupActionsCardViewModel.running] flag, the folded backup-status feed projection, and the
 * PII-safe `view.opened` / `backup.quickRun` diagnostics (P1/S11 — surface slug only). Runs in the
 * :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackupActionsCardViewModelTest {
    @Test
    fun statusFeedProjectsToContent() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(InMemoryBackupActionsCardSource())
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.status.value.phase)
            assertEquals(InMemoryBackupActionsCardSource.SAMPLE_STATUS, vm.status.value.data)
        }

    @Test
    fun statusFeedProjectsEmptyWhenNothingConfiguredOrRun() =
        runTest(UnconfinedTestDispatcher()) {
            val empty = BackupStatus(0, 0, null, null, 0)
            val source = InMemoryBackupActionsCardSource(statusFlow = flowOf(Resource.Success(empty, fetchedAt = 1L, stale = false)))
            val vm = viewModel(source)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.status.value.phase)
        }

    @Test
    fun runQuickBackupRaisesSuccessToastAndClearsRunning() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryBackupActionsCardSource(outcome = { Result.success(Unit) })
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.runQuickBackup()
            advanceUntilIdle()

            assertEquals(1, source.runCalls)
            assertFalse(vm.running.value)
            val message = events.filterIsInstance<UiEvent.Message>().single()
            assertEquals(BACKUP_STARTED_KEY, message.messageKey)
            assertEquals(UiEvent.Severity.Success, message.severity)
        }

    @Test
    fun runQuickBackupRaisesPermissionToastOnForbidden() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryBackupActionsCardSource(outcome = { Result.failure(ApiError.Http(status = 403)) })
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.runQuickBackup()
            advanceUntilIdle()

            val message = events.filterIsInstance<UiEvent.Message>().single()
            assertEquals(BACKUP_PERMISSION_KEY, message.messageKey)
            assertEquals(UiEvent.Severity.Error, message.severity)
        }

    @Test
    fun runQuickBackupRaisesGenericToastOnOtherFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryBackupActionsCardSource(outcome = { Result.failure(IllegalStateException("disk full")) })
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.runQuickBackup()
            advanceUntilIdle()

            val message = events.filterIsInstance<UiEvent.Message>().single()
            assertEquals(BACKUP_FAILED_KEY, message.messageKey)
            assertEquals(UiEvent.Severity.Error, message.severity)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(InMemoryBackupActionsCardSource(), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "BackupActionsCard"), opened.single().second)
        }

    @Test
    fun runQuickBackupLogsThePiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(InMemoryBackupActionsCardSource(), logger)

            vm.runQuickBackup()
            advanceUntilIdle()

            val logged = logger.events.filter { it.first == "backup.quickRun" }
            assertEquals(1, logged.size)
            assertEquals(mapOf("surface" to "BackupActionsCard"), logged.single().second)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: BackupActionsCardSource,
        logger: Logger = NoopLogger,
    ): BackupActionsCardViewModel = BackupActionsCardViewModel(source, logger, backgroundScope)

    private fun TestScope.collectEvents(vm: BackupActionsCardViewModel): List<UiEvent> {
        val events = mutableListOf<UiEvent>()
        backgroundScope.launch { vm.events.collect { events += it } }
        return events
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
