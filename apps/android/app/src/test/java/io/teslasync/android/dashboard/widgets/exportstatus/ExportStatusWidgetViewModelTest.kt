package io.teslasync.android.dashboard.widgets.exportstatus

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
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
 * Drives [ExportStatusWidgetViewModel] over a controllable fake [ExportStatusSource], covering the
 * full cache-then-network state matrix the web component renders by merging `useExports` +
 * `useExportJobs` (loading while either feed first-loads / merged content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch / admin-wins merge) plus the PII-safe
 * `view.opened` diagnostic and the refresh event — end to end through the real
 * [combineExportStatusUi] + [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ExportStatusWidgetViewModelTest {
    private fun job(
        id: String,
        status: JobStatus,
        filePath: String? = null,
    ) = ExportStatusJob(
        id = id,
        format = "csv",
        filePath = filePath,
        fileSizeBytes = 1024,
        createdAt = "2026-06-06T12:00:00Z",
        status = status,
    )

    private val exportRows = listOf(job("e1", JobStatus.Ready, filePath = "/exports/e1.csv"))
    private val adminRows = listOf(job("a1", JobStatus.Processing))

    private class FakeSource(
        var exportsEmissions: List<Resource<List<ExportStatusJob>>>,
        var adminEmissions: List<Resource<List<ExportStatusJob>>>,
    ) : ExportStatusSource {
        override fun exports(): Flow<Resource<List<ExportStatusJob>>> = flow { exportsEmissions.forEach { emit(it) } }

        override fun adminJobs(): Flow<Resource<List<ExportStatusJob>>> = flow { adminEmissions.forEach { emit(it) } }
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
    fun loadingWhenBothFeedsFirstLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        exportsEmissions = listOf(Resource.Loading(null, null, false)),
                        adminEmissions = listOf(Resource.Loading(null, null, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun loadingWhenEitherFeedStillFirstLoads() =
        runTest(UnconfinedTestDispatcher()) {
            // Exports resolved, admin still on its first load → web `isLoading = adminLoading` → skeleton.
            val vm =
                viewModel(
                    FakeSource(
                        exportsEmissions = listOf(Resource.Success(exportRows, 100L, false)),
                        adminEmissions = listOf(Resource.Loading(null, null, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentMergesBothFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        exportsEmissions = listOf(Resource.Success(exportRows, 100L, false)),
                        adminEmissions = listOf(Resource.Success(adminRows, 200L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(setOf("a1", "e1"), state.data?.map { it.id }?.toSet())
            assertEquals(200L, state.fetchedAt) // freshest of the two stamps
        }

    @Test
    fun mergeAppliesAdminWinsForSharedId() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        exportsEmissions = listOf(Resource.Success(listOf(job("x", JobStatus.Queued)), 100L, false)),
                        adminEmissions = listOf(Resource.Success(listOf(job("x", JobStatus.Failed)), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val jobs =
                vm.state.value.data
                    .orEmpty()
            assertEquals(1, jobs.size)
            assertEquals(JobStatus.Failed, jobs.single().status) // admin status wins
        }

    @Test
    fun emptyWhenBothResolveEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        exportsEmissions = listOf(Resource.Success(emptyList(), 100L, false)),
                        adminEmissions = listOf(Resource.Success(emptyList(), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenBothErrorNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        exportsEmissions = listOf(Resource.Error(null, null, false, ApiError.Network())),
                        adminEmissions = listOf(Resource.Error(null, null, false, ApiError.Network())),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedMergeWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            // Exports succeed; admin fails but replays its cached rows (offline / last-known).
            val vm =
                viewModel(
                    FakeSource(
                        exportsEmissions = listOf(Resource.Success(exportRows, 100L, false)),
                        adminEmissions = listOf(Resource.Error(adminRows, 90L, true, ApiError.Timeout())),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(setOf("a1", "e1"), state.data?.map { it.id }?.toSet())
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedJobs() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    exportsEmissions = listOf(Resource.Success(exportRows, 100L, false)),
                    adminEmissions = listOf(Resource.Success(adminRows, 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                setOf("a1", "e1"),
                vm.state.value.data
                    ?.map { it.id }
                    ?.toSet(),
            )

            src.exportsEmissions = listOf(Resource.Success(emptyList(), 300L, false))
            src.adminEmissions = listOf(Resource.Success(listOf(job("a2", JobStatus.Ready)), 300L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(
                listOf("a2"),
                vm.state.value.data
                    ?.map { it.id },
            )
            assertEquals(300L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList(), emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ExportStatusWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList(), emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "exportStatus.refresh" })
        }

    private fun TestScope.viewModel(
        source: ExportStatusSource,
        logger: Logger = NoopLogger,
    ): ExportStatusWidgetViewModel = ExportStatusWidgetViewModel(source, logger, backgroundScope)
}
