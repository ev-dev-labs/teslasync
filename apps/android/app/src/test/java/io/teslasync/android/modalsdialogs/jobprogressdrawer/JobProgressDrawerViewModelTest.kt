package io.teslasync.android.modalsdialogs.jobprogressdrawer

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [JobProgressDrawerViewModel] over a controllable fake [JobProgressDrawerSource], covering the
 * full cache-then-network state matrix the export-job feed can be in (loading / content / empty / hard
 * error + retry / stale-offline + retry), the persisted open/minimized/dismissed drawer machine with
 * the web `useEffect` dismissed -> minimized promotion, and the PII-safe `view.opened` + refresh
 * diagnostics. Mirrors the web component's hook + local-state behaviour
 * (web/src/components/feedback/JobProgressDrawer.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class JobProgressDrawerViewModelTest {
    private fun job(
        id: String,
        status: String = "processing",
    ): ExportJobSummary = ExportJobSummary(id = id, type = "drives", format = "csv", status = status)

    private val populated = listOf(job("a1"))

    private class FakeSource(
        var emissions: List<Resource<List<ExportJobSummary>>>,
    ) : JobProgressDrawerSource {
        var invalidateCount = 0

        override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> = flow { emissions.forEach { emit(it) } }

        override fun invalidate() {
            invalidateCount++
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
            backgroundScope.launch { vm.jobs.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.jobs.value.phase)
        }

    @Test
    fun contentWhenJobsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
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
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
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
    fun defaultPresentationIsMinimized() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(emptyList()))
            assertEquals(DrawerPresentation.Minimized, vm.presentation.value)
        }

    @Test
    fun openMinimizeDismissDriveThePresentation() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(emptyList()))
            vm.open()
            assertEquals(DrawerPresentation.Open, vm.presentation.value)
            vm.minimize()
            assertEquals(DrawerPresentation.Minimized, vm.presentation.value)
            vm.dismiss()
            assertEquals(DrawerPresentation.Dismissed, vm.presentation.value)
        }

    @Test
    fun notifyActiveJobsPromotesDismissedToMinimizedOnlyWhenActive() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(emptyList()))
            vm.dismiss()

            vm.notifyActiveJobs(0)
            assertEquals(DrawerPresentation.Dismissed, vm.presentation.value)

            vm.notifyActiveJobs(2)
            assertEquals(DrawerPresentation.Minimized, vm.presentation.value)
        }

    @Test
    fun notifyActiveJobsDoesNotDisturbOpenOrMinimized() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(emptyList()))
            vm.open()
            vm.notifyActiveJobs(5)
            assertEquals(DrawerPresentation.Open, vm.presentation.value)
        }

    @Test
    fun refreshEmitsDiagnosticAndInvalidatesSource() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = FakeSource(emptyList())
            val vm = viewModel(src, logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "jobProgressDrawer.refresh" })
            assertTrue(src.invalidateCount >= 1)
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
            assertEquals(mapOf("surface" to "JobProgressDrawer"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: JobProgressDrawerSource,
        logger: Logger = NoopLogger,
    ): JobProgressDrawerViewModel = JobProgressDrawerViewModel(source, logger, DEFAULT_MAX_RECENT, backgroundScope)
}
