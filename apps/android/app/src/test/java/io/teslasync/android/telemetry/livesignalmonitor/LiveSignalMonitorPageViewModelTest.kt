package io.teslasync.android.telemetry.livesignalmonitor

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [LiveSignalMonitorPageViewModel] + its framework-free model over a controllable fake
 * [LiveSignalMonitorPageSource], covering the connection slice the web page derives from `useLiveSignalStream`
 * for its header badge: only `Connection.Open`/`Stale` (→ [LiveConnectionStatus.Connected]) read as "connected"
 * (web `live.connected` → success/danger), the freshness fields are carried through, retry forwards to the
 * shared stream, and the PII-safe `view.opened` diagnostic fires exactly once.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalMonitorPageViewModelTest {
    private class FakeSource : LiveSignalMonitorPageSource {
        val feed = MutableSharedFlow<LiveMonitorConnection>(replay = 1, extraBufferCapacity = 16)
        var reconnectCount = 0

        override fun connection(): Flow<LiveMonitorConnection> = feed

        override fun reconnect() {
            reconnectCount++
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
    fun onlyConnectedStatusReadsAsConnected() {
        assertTrue(isLiveConnected(LiveConnectionStatus.Connected))
        assertFalse(isLiveConnected(LiveConnectionStatus.Reconnecting))
        assertFalse(isLiveConnected(LiveConnectionStatus.Disconnected))
        assertFalse(isLiveConnected(LiveConnectionStatus.Unknown))
    }

    @Test
    fun uiStateProjectsTheLiveConnectionSlice() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.uiState.collect {} }
            runCurrent()

            src.feed.tryEmit(LiveMonitorConnection(LiveConnectionStatus.Connected, isStale = false, lastMessageAtMillis = 1_000L))
            runCurrent()
            assertTrue(vm.uiState.value.connected)
            assertEquals(1_000L, vm.uiState.value.lastMessageAtMillis)

            src.feed.tryEmit(LiveMonitorConnection(LiveConnectionStatus.Disconnected, isStale = false, lastMessageAtMillis = 1_000L))
            runCurrent()
            assertFalse(vm.uiState.value.connected)
        }

    @Test
    fun staleFlagSurfacesWhileTheWireIsStillUp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.uiState.collect {} }
            runCurrent()

            src.feed.tryEmit(LiveMonitorConnection(LiveConnectionStatus.Connected, isStale = true, lastMessageAtMillis = 2_000L))
            runCurrent()

            assertTrue(vm.uiState.value.isStale)
            assertTrue(vm.uiState.value.connected)
        }

    @Test
    fun retryForwardsToTheSharedStream() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            vm.retry()
            assertEquals(1, src.reconnectCount)
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
            assertEquals(mapOf("surface" to LiveSignalMonitorPageRegistration.SLUG), opened.single().second)
        }

    @Test
    fun retryEmitsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = FakeSource()
            val vm = viewModel(src, logger = logger)

            vm.retry()

            assertTrue(logger.events.any { it.first == "liveSignalMonitor.retry" })
            assertFalse(logger.events.any { it.second.containsKey("value") })
        }

    private fun TestScope.viewModel(
        source: LiveSignalMonitorPageSource,
        logger: Logger = NoopLogger,
    ): LiveSignalMonitorPageViewModel = LiveSignalMonitorPageViewModel(source, logger, backgroundScope)
}
