package io.teslasync.android.dashboardwidgets.notificationstats

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [NotificationStatsWidgetViewModel] against the [NotificationStatsSource] seam with a fake
 * stats+logs feed — covering the states the web widget renders (loading / content / hard error /
 * offline-cached, plus the logs feed's empty phase), the refresh + retry re-fetch of BOTH feeds, and
 * the one-shot `view.opened` diagnostics event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationStatsWidgetViewModelTest {
    private class FakeSource(
        private val statsEmissions: List<Resource<NotificationStats>>,
        private val logsEmissions: List<Resource<List<NotificationLog>>>,
    ) : NotificationStatsSource {
        var statsCalls = 0
            private set
        var logsCalls = 0
            private set

        override fun stats(): Flow<Resource<NotificationStats>> {
            statsCalls++
            return statsEmissions.asFlow()
        }

        override fun logs(): Flow<Resource<List<NotificationLog>>> {
            logsCalls++
            return logsEmissions.asFlow()
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

    private fun stats(): NotificationStats = NotificationStats(totalSent = 10, sent = 9, failed = 1, enabledChannels = 2)

    private fun log(id: Long): NotificationLog = NotificationLog(id = id, status = "sent", createdAt = "2024-01-0${id}T00:00:00Z")

    @Test
    fun loadsContentForBothFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    statsEmissions =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            Resource.Success(stats(), fetchedAt = 100L, stale = false),
                        ),
                    logsEmissions = listOf(Resource.Success(listOf(log(1), log(2)), fetchedAt = 100L, stale = false)),
                )
            val vm = NotificationStatsWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            backgroundScope.launch { vm.logs.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.stats.value.phase)
            assertNotNull(vm.stats.value.data)
            assertEquals(UiPhase.Content, vm.logs.value.phase)
            assertEquals(
                2,
                vm.logs.value.data
                    ?.size,
            )
        }

    @Test
    fun resolvedStatsAlwaysRenderContentNeverEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            // All-zero stats resolve to Content (web `{stats ? grid : EmptyState}` shows the zero grid).
            val source =
                FakeSource(
                    statsEmissions = listOf(Resource.Success(NotificationStats(), fetchedAt = 100L, stale = false)),
                    logsEmissions = listOf(Resource.Success(emptyList(), fetchedAt = 100L, stale = false)),
                )
            val vm = NotificationStatsWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            backgroundScope.launch { vm.logs.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.stats.value.phase)
            // The logs feed itself reports Empty for an empty list (it never gates the panel surface).
            assertEquals(UiPhase.Empty, vm.logs.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    statsEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    logsEmissions = listOf(Resource.Success(emptyList(), fetchedAt = 100L, stale = false)),
                )
            val vm = NotificationStatsWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            backgroundScope.launch { vm.logs.collect {} }
            advanceUntilIdle()

            val state = vm.stats.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.hasError)
            assertFalse(state.hasData)
        }

    @Test
    fun offlineKeepsCachedStatsWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    statsEmissions =
                        listOf(Resource.Error(cached = stats(), fetchedAt = 100L, stale = true, error = ApiError.Network())),
                    logsEmissions = listOf(Resource.Success(listOf(log(1)), fetchedAt = 100L, stale = false)),
                )
            val vm = NotificationStatsWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            backgroundScope.launch { vm.logs.collect {} }
            advanceUntilIdle()

            val state = vm.stats.value
            assertEquals(UiPhase.Content, state.phase)
            assertNotNull(state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshReFetchesBothFeedsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    statsEmissions = listOf(Resource.Success(stats(), fetchedAt = 100L, stale = false)),
                    logsEmissions = listOf(Resource.Success(listOf(log(1)), fetchedAt = 100L, stale = false)),
                )
            val logger = RecordingLogger()
            val vm = NotificationStatsWidgetViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            backgroundScope.launch { vm.logs.collect {} }
            advanceUntilIdle()
            assertEquals(1, source.statsCalls)
            assertEquals(1, source.logsCalls)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2, source.statsCalls)
            assertEquals(2, source.logsCalls)
            assertTrue(logger.records.any { it.event == "notificationStats.refresh" })
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    statsEmissions = listOf(Resource.Success(stats(), fetchedAt = 100L, stale = false)),
                    logsEmissions = listOf(Resource.Success(listOf(log(1)), fetchedAt = 100L, stale = false)),
                )
            val vm = NotificationStatsWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.stats.collect {} }
            backgroundScope.launch { vm.logs.collect {} }
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            assertEquals(2, source.statsCalls)
            assertEquals(2, source.logsCalls)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(emptyList(), emptyList())
            val vm = NotificationStatsWidgetViewModel(source, logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("NotificationStatsWidget", opened.first().fields["slug"])
        }
}
