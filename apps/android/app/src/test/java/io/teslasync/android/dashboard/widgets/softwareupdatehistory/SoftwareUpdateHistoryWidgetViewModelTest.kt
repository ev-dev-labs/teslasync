package io.teslasync.android.dashboard.widgets.softwareupdatehistory

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
 * Drives [SoftwareUpdateHistoryWidgetViewModel] over a controllable fake [SoftwareUpdateHistorySource],
 * covering the full cache-then-network state matrix the web component renders (loading / content / empty /
 * hard error + retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic
 * and the refresh event — end to end through the real [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SoftwareUpdateHistoryWidgetViewModelTest {
    private val respA = listOf(SoftwareUpdateEntry(1, "2026.20.5", "installed", "2026-06-06T12:00:00Z", null, null))
    private val respB = listOf(SoftwareUpdateEntry(2, "2026.21.0", "downloading", null, null, "2026-06-07T12:00:00Z"))
    private val emptyResp = emptyList<SoftwareUpdateEntry>()

    private class FakeHistorySource(
        var emissions: List<Resource<List<SoftwareUpdateEntry>>>,
    ) : SoftwareUpdateHistorySource {
        override fun history(): Flow<Resource<List<SoftwareUpdateEntry>>> = flow { emissions.forEach { emit(it) } }
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
            val vm = viewModel(FakeHistorySource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeHistorySource(listOf(Resource.Loading(null, null, false), Resource.Success(respA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(respA, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoUpdates() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeHistorySource(listOf(Resource.Success(emptyResp, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeHistorySource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeHistorySource(listOf(Resource.Success(respA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(respA, vm.state.value.data)

            src.emissions = listOf(Resource.Error(respA, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(respA, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedHistory() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeHistorySource(listOf(Resource.Success(respA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(respA, vm.state.value.data)

            src.emissions = listOf(Resource.Success(respB, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(respB, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeHistorySource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SoftwareUpdateHistoryWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeHistorySource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "softwareUpdateHistory.refresh" })
        }

    private fun TestScope.viewModel(
        source: SoftwareUpdateHistorySource,
        logger: Logger = NoopLogger,
    ): SoftwareUpdateHistoryWidgetViewModel = SoftwareUpdateHistoryWidgetViewModel(source, logger, backgroundScope)
}
