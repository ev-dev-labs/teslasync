package io.teslasync.android.featureviews.datapipelinesection

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
 * Drives [DataPipelineSectionViewModel] over a controllable fake [DataPipelineSource], covering the full
 * cache-then-network state matrix the web component renders by composing `getCompressionStats` +
 * `getExportJobs` (loading while either feed first-loads / merged content / empty / hard error + retry /
 * stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic and the refresh
 * event — end to end through the real [combineDataPipelineUi] + [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DataPipelineSectionViewModelTest {
    private val stats = CompressionStats(savingsPercent = 72.4, totalPositions = 100, estimatedSavedBytes = 2048)

    private fun job(
        id: String,
        status: String = "ready",
    ) = ExportJobSummary(
        id = id,
        type = "drives",
        format = "csv",
        status = status,
        fileName = "drives-$id.csv",
        recordCount = 10L,
        createdAt = "2026-06-06T12:00:00Z",
    )

    private val jobs = listOf(job("e1", "ready"), job("e2", "processing"))

    private class FakeSource(
        var compressionEmissions: List<Resource<CompressionStats?>>,
        var exportEmissions: List<Resource<List<ExportJobSummary>>>,
    ) : DataPipelineSource {
        override fun compressionStats(): Flow<Resource<CompressionStats?>> = flow { compressionEmissions.forEach { emit(it) } }

        override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> = flow { exportEmissions.forEach { emit(it) } }
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
                        compressionEmissions = listOf(Resource.Loading(null, null, false)),
                        exportEmissions = listOf(Resource.Loading(null, null, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun loadingWhenEitherFeedStillFirstLoads() =
        runTest(UnconfinedTestDispatcher()) {
            // Compression resolved, export still first-loading → web `isLoading = exportLoading` → skeletons.
            val vm =
                viewModel(
                    FakeSource(
                        compressionEmissions = listOf(Resource.Success(stats, 100L, false)),
                        exportEmissions = listOf(Resource.Loading(null, null, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentPairsCompressionAndJobs() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        compressionEmissions = listOf(Resource.Success(stats, 100L, false)),
                        exportEmissions = listOf(Resource.Success(jobs, 200L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(stats, state.data?.compression)
            assertEquals(listOf("e1", "e2"), state.data?.exportJobs?.map { it.id })
            assertEquals(200L, state.fetchedAt) // freshest of the two stamps
        }

    @Test
    fun emptyWhenNoCompressionAndNoJobs() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        compressionEmissions = listOf(Resource.Success(null, 100L, false)),
                        exportEmissions = listOf(Resource.Success(emptyList(), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun contentWhenJobsPresentButCompressionMissing() =
        runTest(UnconfinedTestDispatcher()) {
            // Compression query failed/empty (block hidden) but export resolved → still content (web parity).
            val vm =
                viewModel(
                    FakeSource(
                        compressionEmissions = listOf(Resource.Success(null, 100L, false)),
                        exportEmissions = listOf(Resource.Success(jobs, 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(null, state.data?.compression)
            assertEquals(2, state.data?.exportJobs?.size)
        }

    @Test
    fun hardErrorWithRetryWhenBothErrorNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        compressionEmissions = listOf(Resource.Error(null, null, false, ApiError.Network())),
                        exportEmissions = listOf(Resource.Error(null, null, false, ApiError.Network())),
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
    fun staleOfflineKeepsCachedWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            // Compression succeeds; export fails but replays its cached rows (offline / last-known).
            val vm =
                viewModel(
                    FakeSource(
                        compressionEmissions = listOf(Resource.Success(stats, 100L, false)),
                        exportEmissions = listOf(Resource.Error(jobs, 90L, true, ApiError.Timeout())),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(listOf("e1", "e2"), state.data?.exportJobs?.map { it.id })
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedData() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    compressionEmissions = listOf(Resource.Success(stats, 100L, false)),
                    exportEmissions = listOf(Resource.Success(jobs, 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val initial = vm.state.value
            assertEquals(2, initial.data?.exportJobs?.size)

            src.compressionEmissions = listOf(Resource.Success(null, 300L, false))
            src.exportEmissions = listOf(Resource.Success(listOf(job("e3", "ready")), 300L, false))
            vm.refresh()
            advanceUntilIdle()

            val refreshed = vm.state.value
            assertEquals(listOf("e3"), refreshed.data?.exportJobs?.map { it.id })
            assertEquals(300L, refreshed.fetchedAt)
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
            assertEquals(mapOf("surface" to "DataPipelineSection"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList(), emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "dataPipeline.refresh" })
        }

    private fun TestScope.viewModel(
        source: DataPipelineSource,
        logger: Logger = NoopLogger,
    ): DataPipelineSectionViewModel = DataPipelineSectionViewModel(source, logger, backgroundScope)
}
