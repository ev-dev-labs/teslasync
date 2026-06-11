package io.teslasync.android.dashboardwidgets.alertfeed

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.Alert
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

/**
 * Tests [AlertFeedWidgetViewModel] against the [AlertFeedSource] seam with a fake feed — covering
 * every state the web widget renders (loading / content / empty / hard error / offline-cached /
 * stale-empty), the refresh + retry re-fetch, and the one-shot `view.opened` diagnostics event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertFeedWidgetViewModelTest {
    private class FakeAlertFeedSource(
        private val emissions: List<Resource<List<Alert>>>,
    ) : AlertFeedSource {
        var streamCalls = 0
            private set

        override fun stream(): Flow<Resource<List<Alert>>> {
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

    private fun alert(id: Long): Alert = Alert(id = id, severity = "critical", title = "Alert $id", createdAt = "2024-01-0${id}T00:00:00Z")

    @Test
    fun loadsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeAlertFeedSource(
                    listOf(
                        Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        Resource.Success(listOf(alert(1), alert(2)), fetchedAt = 100L, stale = false),
                    ),
                )
            val vm = AlertFeedWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.alerts.collect {} }
            advanceUntilIdle()

            val state = vm.alerts.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun emptyInboxIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeAlertFeedSource(listOf(Resource.Success(emptyList(), fetchedAt = 100L, stale = false)))
            val vm = AlertFeedWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.alerts.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.alerts.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeAlertFeedSource(
                    listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = AlertFeedWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.alerts.collect {} }
            advanceUntilIdle()

            val state = vm.alerts.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.hasError)
            assertFalse(state.hasData)
        }

    @Test
    fun offlineKeepsCachedRowsWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeAlertFeedSource(
                    listOf(
                        Resource.Error(cached = listOf(alert(1)), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                    ),
                )
            val vm = AlertFeedWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.alerts.collect {} }
            advanceUntilIdle()

            val state = vm.alerts.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data?.size)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleEmptyCacheStillRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeAlertFeedSource(
                    listOf(Resource.Error(cached = emptyList(), fetchedAt = 100L, stale = true, error = ApiError.Network())),
                )
            val vm = AlertFeedWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.alerts.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.alerts.value.phase)
            assertTrue(vm.alerts.value.stale)
        }

    @Test
    fun refreshReFetchesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeAlertFeedSource(listOf(Resource.Success(listOf(alert(1)), fetchedAt = 100L, stale = false)))
            val logger = RecordingLogger()
            val vm = AlertFeedWidgetViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.alerts.collect {} }
            advanceUntilIdle()
            assertEquals(1, source.streamCalls)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2, source.streamCalls)
            assertTrue(logger.records.any { it.event == "alertFeed.refresh" })
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeAlertFeedSource(listOf(Resource.Success(listOf(alert(1)), fetchedAt = 100L, stale = false)))
            val vm = AlertFeedWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.alerts.collect {} }
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            assertEquals(2, source.streamCalls)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeAlertFeedSource(emptyList())
            val vm = AlertFeedWidgetViewModel(source, logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("AlertFeedWidget", opened.first().fields["slug"])
        }
}
