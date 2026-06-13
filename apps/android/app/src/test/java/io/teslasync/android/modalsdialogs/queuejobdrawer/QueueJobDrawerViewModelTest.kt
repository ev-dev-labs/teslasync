package io.teslasync.android.modalsdialogs.queuejobdrawer

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.QUEUE_JOBS_DEFAULT_LIMIT
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.systemqueues.QueueJobView
import io.teslasync.shared.core.presentation.systemqueues.QueueJobsResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [QueueJobDrawerViewModel] over a controllable fake [QueueJobDrawerSource], covering the full
 * cache-then-network state matrix the per-worker jobs feed can be in (loading / content / empty / hard
 * error + retry / stale-offline + retry), the open-time `worker` + `enabled` target gating (the web
 * `useQueueJobs(worker, { enabled })` args), and the PII-safe `view.opened` + refresh diagnostics.
 * Mirrors the web component's hook behaviour
 * (web/src/features/admin/components/QueueJobDrawer.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QueueJobDrawerViewModelTest {
    private fun resp(vararg ids: String): QueueJobsResponse =
        QueueJobsResponse(
            worker = "notification",
            jobs =
                ids.map {
                    QueueJobView(
                        id = it,
                        worker = "notification",
                        status = "sent",
                        title = "Job $it",
                        startedAt = "2026-06-11T12:00:00Z",
                    )
                },
        )

    private val populated = resp("a1")

    private class FakeSource(
        var emissions: List<Resource<QueueJobsResponse>>,
    ) : QueueJobDrawerSource {
        var refreshCount = 0
        val calls = mutableListOf<Triple<String, Boolean, Int>>()

        override fun queueJobs(
            worker: String,
            enabled: Boolean,
            limit: Int,
        ): Flow<Resource<QueueJobsResponse>> {
            calls += Triple(worker, enabled, limit)
            return flow { emissions.forEach { emit(it) } }
        }

        override fun refresh(worker: String) {
            refreshCount++
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
            vm.setTarget("notification", true)
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.jobs.value.phase)
        }

    @Test
    fun contentWhenJobsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            vm.setTarget("notification", true)
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()

            val state = vm.jobs.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoJobs() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(resp(), 100L, false))))
            vm.setTarget("notification", true)
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.jobs.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            vm.setTarget("notification", true)
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()

            val state = vm.jobs.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            vm.setTarget("notification", true)
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()
            assertEquals(populated, vm.jobs.value.data)

            src.emissions = listOf(Resource.Error(populated, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.jobs.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun blankWorkerStaysDisabledRegardlessOfEnabledFlag() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)
            vm.setTarget("", enabled = true)
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()

            assertTrue(src.calls.isNotEmpty())
            // A blank worker forces the feed disabled (the web `enabled: open && worker` gate).
            assertEquals("", src.calls.last().first)
            assertFalse(src.calls.last().second)
        }

    @Test
    fun concreteWorkerEnablesTheFeedWithDefaultLimit() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)
            vm.setTarget("export", enabled = true)
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()

            assertTrue(src.calls.any { it.first == "export" && it.second && it.third == QUEUE_JOBS_DEFAULT_LIMIT })
            assertEquals(QueueJobTarget("export", true), vm.target.value)
        }

    @Test
    fun refreshEmitsDiagnosticAndRefreshesSource() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = FakeSource(emptyList())
            val vm = viewModel(src, logger)
            vm.setTarget("notification", true)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "queueJobDrawer.refresh" })
            assertTrue(src.refreshCount >= 1)
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
            assertEquals(mapOf("surface" to "QueueJobDrawer"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: QueueJobDrawerSource,
        logger: Logger = NoopLogger,
    ): QueueJobDrawerViewModel = QueueJobDrawerViewModel(source, logger, QUEUE_JOBS_DEFAULT_LIMIT, backgroundScope)
}
