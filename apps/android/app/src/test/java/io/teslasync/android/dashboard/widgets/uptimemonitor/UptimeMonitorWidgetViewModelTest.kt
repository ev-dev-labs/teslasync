package io.teslasync.android.dashboard.widgets.uptimemonitor

import io.teslasync.android.data.NoopLogger
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [UptimeMonitorWidgetViewModel] over a controllable fake [UptimeMonitorSource], covering the
 * cache-then-network state matrix the web `UptimeMonitorWidget` renders: loading (no cache), content on
 * success, the empty surface when the resolved snapshot is null (web `data ? body : <EmptyState>`), hard
 * error (no cache), the stale/offline branch (cached snapshot kept visible with the stale + error flags —
 * web `WidgetShell` freshness), the refresh re-fetch (web `refetch()`), and the PII-safe `view.opened`
 * diagnostic — end to end through the real [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UptimeMonitorWidgetViewModelTest {
    /** A fake whose feed is re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : UptimeMonitorSource {
        var emissions: List<Resource<UptimeHealth?>> = listOf(loading())

        override fun stream(): Flow<Resource<UptimeHealth?>> = flow { emissions.forEach { emit(it) } }
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
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isLoading)
            assertNull(vm.state.value.data)
        }

    @Test
    fun contentOnSuccess() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(health(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state.isContent)
            assertNotNull(state.data)
            assertEquals(100L, state.fetchedAt)
            assertFalse(state.hasError)
        }

    @Test
    fun emptyWhenSnapshotResolvesNull() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(null, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state.isEmpty)
            assertNull(state.data)
        }

    @Test
    fun errorWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            assertNull(vm.state.value.data)
        }

    @Test
    fun staleOfflineKeepsCachedSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Error(health(), 100L, true, ApiError.Timeout()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.data)
            assertTrue(state.stale)
            assertTrue(state.hasError)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun refreshReFetchesSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(health(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.emissions = listOf(Resource.Success(health(), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "UptimeMonitorWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "uptimeMonitor.refresh" })
            assertFalse(
                logger.events.any {
                    it.second.containsKey("status") || it.second.containsKey("databaseSize") || it.second.containsKey("tableCount")
                },
            )
        }

    private fun TestScope.viewModel(
        source: UptimeMonitorSource,
        logger: Logger = NoopLogger,
    ): UptimeMonitorWidgetViewModel = UptimeMonitorWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<UptimeHealth?> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun health(): UptimeHealth =
            UptimeHealth(
                overallStatus = "healthy",
                componentStatuses =
                    mapOf(
                        "database" to "healthy",
                        "mqtt" to "healthy",
                        "tesla_api" to "healthy",
                        "fleet_telemetry" to "healthy",
                    ),
                databaseSize = "1.4 GB",
                tableCount = 87L,
            )
    }
}
