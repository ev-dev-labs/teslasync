package io.teslasync.android.featureviews.scheduledexportspanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportDelivery
import io.teslasync.shared.core.presentation.exports.ScheduledExportInput
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ScheduledExportsPanelViewModel] over a controllable fake [ScheduledExportsPanelSource], covering the full
 * cache-then-network state matrix the schedules list can be in (loading / content / empty / hard error + retry /
 * stale-offline + retry), every mutation (create / update / delete / run-now / toggle) with its source delegation +
 * post-mutation refresh + typed [ScheduledExportToast] on failure, the per-row run-now in-flight tracking, and the
 * PII-safe `view.opened` + refresh diagnostics. Mirrors the web component's hook behaviour
 * (web/src/features/system/pages/ScheduledExportsPanel.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScheduledExportsPanelViewModelTest {
    private fun schedule(
        id: Long,
        name: String = "Drives weekly",
        enabled: Boolean = true,
        delivery: ScheduledExportDelivery = ScheduledExportDelivery(kind = "download"),
    ): ScheduledExport =
        ScheduledExport(
            id = id,
            name = name,
            exportType = "drives",
            format = "csv",
            scheduleCron = "0 9 * * 0",
            delivery = delivery,
            rangeWindow = "7d",
            enabled = enabled,
        )

    private val populated = listOf(schedule(1))

    private class FakeSource(
        var emissions: List<Resource<List<ScheduledExport>>>,
    ) : ScheduledExportsPanelSource {
        var createResult: Result<ScheduledExport> =
            Result.success(ScheduledExport(id = 1))
        var updateResult: Result<ScheduledExport> =
            Result.success(ScheduledExport(id = 1))
        var deleteResult: Result<Unit> = Result.success(Unit)
        var runResult: Result<ScheduledExport> =
            Result.success(ScheduledExport(id = 1))
        var runGate: CompletableDeferred<Unit>? = null
        val created = mutableListOf<ScheduledExportInput>()
        val updated = mutableListOf<Pair<Long, ScheduledExportInput>>()
        val deleted = mutableListOf<Long>()
        val ranNow = mutableListOf<Long>()
        var invalidateCount = 0

        override fun scheduledExports(): Flow<Resource<List<ScheduledExport>>> = flow { emissions.forEach { emit(it) } }

        override fun invalidate() {
            invalidateCount++
        }

        override suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport> {
            created += input
            return createResult
        }

        override suspend fun updateScheduledExport(
            id: Long,
            input: ScheduledExportInput,
        ): Result<ScheduledExport> {
            updated += id to input
            return updateResult
        }

        override suspend fun deleteScheduledExport(id: Long): Result<Unit> {
            deleted += id
            return deleteResult
        }

        override suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport> {
            ranNow += id
            runGate?.await()
            return runResult
        }
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

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.schedules.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.schedules.value.phase)
        }

    @Test
    fun contentWhenSchedulesPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.schedules.collect {} }
            advanceUntilIdle()

            val state = vm.schedules.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoSchedules() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
            backgroundScope.launch { vm.schedules.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.schedules.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.schedules.collect {} }
            advanceUntilIdle()

            val state = vm.schedules.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.schedules.collect {} }
            advanceUntilIdle()
            assertEquals(populated, vm.schedules.value.data)

            src.emissions = listOf(Resource.Error(populated, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.schedules.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun saveCreateDelegatesAndRefreshes() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val form = emptyScheduledExportForm().copy(name = "New schedule")

            val saved = vm.save(editingId = null, form = form)

            assertTrue(saved)
            assertEquals(listOf(toScheduledExportInput(form)), src.created)
            assertTrue(src.invalidateCount >= 1)
        }

    @Test
    fun saveUpdateDelegatesToUpdate() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val form = emptyScheduledExportForm().copy(name = "Edited")

            val saved = vm.save(editingId = 5, form = form)

            assertTrue(saved)
            assertEquals(listOf(5L to toScheduledExportInput(form)), src.updated)
        }

    @Test
    fun saveFailureReturnsFalseAndRaisesToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.createResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            val saved = vm.save(editingId = null, form = emptyScheduledExportForm().copy(name = "New"))
            advanceUntilIdle()

            assertEquals(false, saved)
            assertEquals(listOf<ScheduledExportToast>(ScheduledExportToast.ActionFailed), received)
        }

    @Test
    fun toggleUpdatesWithFlippedEnabled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val row = schedule(7, enabled = true)

            vm.toggle(row)
            advanceUntilIdle()

            assertEquals(listOf(7L to toggledScheduledExportInput(row)), src.updated)
            val toggledInput = src.updated[0].second
            assertEquals(false, toggledInput.enabled)
        }

    @Test
    fun toggleFailureRaisesToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.updateResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(schedule(9, enabled = true))
            advanceUntilIdle()

            assertEquals(listOf<ScheduledExportToast>(ScheduledExportToast.ActionFailed), received)
        }

    @Test
    fun runNowTracksRunningIdAndClearsAfter() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.runGate = CompletableDeferred()
            val vm = viewModel(src)

            vm.runScheduledExportNow(7)
            advanceUntilIdle()
            assertEquals(7L, vm.runningNowId.value)

            src.runGate!!.complete(Unit)
            advanceUntilIdle()
            assertNull(vm.runningNowId.value)
            assertEquals(listOf(7L), src.ranNow)
            assertTrue(src.invalidateCount >= 1)
        }

    @Test
    fun runNowFailureRaisesToastAndClearsRunningId() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.runResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.runScheduledExportNow(3)
            advanceUntilIdle()

            assertEquals(listOf<ScheduledExportToast>(ScheduledExportToast.ActionFailed), received)
            assertNull(vm.runningNowId.value)
        }

    @Test
    fun deleteDelegatesAndRefreshes() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)

            vm.delete(5)
            advanceUntilIdle()

            assertEquals(listOf(5L), src.deleted)
            assertTrue(src.invalidateCount >= 1)
        }

    @Test
    fun deleteFailureRaisesToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.deleteResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.delete(5)
            advanceUntilIdle()

            assertEquals(listOf<ScheduledExportToast>(ScheduledExportToast.ActionFailed), received)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ScheduledExportsPanel"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticAndInvalidatesSource() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = FakeSource(emptyList())
            val vm = viewModel(src, logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "scheduledExports.refresh" })
            assertTrue(src.invalidateCount >= 1)
        }

    private fun TestScope.collectToasts(vm: ScheduledExportsPanelViewModel): List<ScheduledExportToast> {
        val received = mutableListOf<ScheduledExportToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    private fun TestScope.viewModel(
        source: ScheduledExportsPanelSource,
        logger: Logger = NoopLogger,
    ): ScheduledExportsPanelViewModel = ScheduledExportsPanelViewModel(source, logger, backgroundScope)
}
