package io.teslasync.android.dashboard.widgets.automationhistory

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.automations.AutomationHistory
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationHistoryStats
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
 * Drives [AutomationHistoryWidgetViewModel] over a controllable fake [AutomationHistorySource], covering
 * the full cache-then-network state matrix the web component renders (loading / content / empty / hard
 * error + retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic and
 * the refresh event — end to end through the real projection pipeline.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutomationHistoryWidgetViewModelTest {
    private val respA = response(rate = 91.5, total = 120, name = "Morning Charge")
    private val respB = response(rate = 42.0, total = 200, name = "Evening Precondition")
    private val emptyResp = AutomationHistoryListResponse(items = emptyList(), summary = AutomationHistoryStats())

    private class FakeHistorySource(
        var emissions: List<Resource<AutomationHistoryListResponse>>,
    ) : AutomationHistorySource {
        override fun history(): Flow<Resource<AutomationHistoryListResponse>> = flow { emissions.forEach { emit(it) } }
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
    fun emptyWhenNoRuns() =
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
            assertEquals(mapOf("surface" to "AutomationHistoryWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeHistorySource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "automationHistory.refresh" })
        }

    private fun TestScope.viewModel(
        source: AutomationHistorySource,
        logger: Logger = NoopLogger,
    ): AutomationHistoryWidgetViewModel = AutomationHistoryWidgetViewModel(source, logger, backgroundScope)

    private fun response(
        rate: Double,
        total: Long,
        name: String,
    ): AutomationHistoryListResponse =
        AutomationHistoryListResponse(
            items =
                listOf(
                    AutomationHistory(
                        id = 1,
                        automationId = 7,
                        automationName = name,
                        triggeredAt = "2026-06-06T12:00:00Z",
                        durationMs = 1_500,
                        status = "success",
                    ),
                ),
            summary = AutomationHistoryStats(totalExecutions = total, successRate = rate),
        )
}
