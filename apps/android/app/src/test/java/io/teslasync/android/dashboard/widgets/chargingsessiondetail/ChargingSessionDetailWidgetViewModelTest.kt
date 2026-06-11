package io.teslasync.android.dashboard.widgets.chargingsessiondetail

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Tests [ChargingSessionDetailWidgetViewModel] against the [ChargingSessionDetailSource] seam with a fake
 * feed — covering every state the web widget renders (loading / content / empty / hard error /
 * offline-cached), the refresh + retry re-fetch, and the one-shot `view.opened` diagnostics event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingSessionDetailWidgetViewModelTest {
    private class FakeSource(
        private val emissions: List<Resource<ChargingSessionDetailSnapshot>>,
    ) : ChargingSessionDetailSource {
        var streamCalls = 0
            private set

        override fun stream(): Flow<Resource<ChargingSessionDetailSnapshot>> {
            streamCalls++
            return emissions.asFlow()
        }
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private fun session(): ChargingSession = ChargingSession(id = 1, startedAt = Instant.parse("2024-01-01T10:00:00Z"), vehicleId = 7)

    private fun snapshot(): ChargingSessionDetailSnapshot = ChargingSessionDetailSnapshot(detail = session())

    @Test
    fun loadsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        Resource.Success(snapshot(), fetchedAt = 100L, stale = false),
                    ),
                )
            val vm = ChargingSessionDetailWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.data?.detail != null)
        }

    @Test
    fun nullDetailIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Success(ChargingSessionDetailSnapshot(detail = null), fetchedAt = 100L, stale = false)))
            val vm = ChargingSessionDetailWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val vm = ChargingSessionDetailWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.hasError)
            assertFalse(state.hasData)
        }

    @Test
    fun offlineKeepsCachedSnapshotWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(Resource.Error(cached = snapshot(), fetchedAt = 100L, stale = true, error = ApiError.Network())),
                )
            val vm = ChargingSessionDetailWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.data?.detail != null)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshReFetchesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Success(snapshot(), fetchedAt = 100L, stale = false)))
            val logger = RecordingLogger()
            val vm = ChargingSessionDetailWidgetViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(1, source.streamCalls)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2, source.streamCalls)
            assertTrue(logger.records.any { it.event == "chargingSessionDetail.refresh" })
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Success(snapshot(), fetchedAt = 100L, stale = false)))
            val vm = ChargingSessionDetailWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            assertEquals(2, source.streamCalls)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = ChargingSessionDetailWidgetViewModel(FakeSource(emptyList()), logger, backgroundScope)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ChargingSessionDetailWidget", opened.first().fields["slug"])
        }
}
