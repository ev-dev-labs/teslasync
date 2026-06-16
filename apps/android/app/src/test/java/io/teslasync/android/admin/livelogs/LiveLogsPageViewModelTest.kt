package io.teslasync.android.admin.livelogs

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.sse.SseTransport
import io.teslasync.shared.core.presentation.logstream.LogStreamLevel
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
 * Drives [LiveLogsPageViewModel] over a controllable fake SSE transport (the same public
 * [io.teslasync.shared.core.net.sse.SseTransport] seam production binds), covering the live-tail behaviour the
 * web `useLogStream` owns: the synchronous interaction setters (level/grep/maxLength/vehicle/autoscroll/
 * reconnect), the cold-start "Connecting" state, a `log` frame surfacing as a Connected content row, the
 * client-side vehicle filter, pause keeping the connection open while it stops appending, clear emptying the
 * buffer, and the PII-safe `view.opened` diagnostic firing exactly once. The view-model is bound to
 * [TestScope.backgroundScope] (the sibling live-surface precedent) so the `WhileSubscribed` upstream is torn
 * down with the test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveLogsPageViewModelTest {
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

    private fun logFrame(json: String): String = "event: log\ndata: $json\n\n"

    @Test
    fun interactionSettersUpdateSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(sourceOf(MutableSharedFlow()))

            vm.setLevel(LogStreamLevel.Error)
            vm.setGrepDraft("x".repeat(300))
            vm.setVehicleFilter("  7  ")
            vm.setAutoscroll(false)
            runCurrent()

            val interaction = vm.interaction.value
            assertEquals(LogStreamLevel.Error, interaction.level)
            assertEquals(256, interaction.grepDraft.length)
            assertEquals("7", interaction.vehicleFilter)
            assertFalse(interaction.autoscroll)

            vm.applyGrep()
            runCurrent()
            assertEquals(vm.interaction.value.grepDraft, vm.interaction.value.grep)
        }

    @Test
    fun reconnectBumpsEpochAndKeepsEnabled() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(sourceOf(MutableSharedFlow()))
            val epoch = vm.interaction.value.reconnectEpoch

            vm.reconnect()
            runCurrent()

            assertEquals(epoch + 1, vm.interaction.value.reconnectEpoch)
            assertTrue(vm.interaction.value.enabled)
        }

    @Test
    fun viewOpenedFiresExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(sourceOf(MutableSharedFlow()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            assertEquals(1, logger.events.count { it.first == "view.opened" })
            assertEquals(LiveLogsRegistration.SLUG, logger.events.first { it.first == "view.opened" }.second["surface"])
        }

    @Test
    fun coldStartIsConnectingThenContentOnLogFrame() =
        runTest(UnconfinedTestDispatcher()) {
            val chunks = MutableSharedFlow<String>(extraBufferCapacity = 16)
            val vm = viewModel(sourceOf(chunks))
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            assertEquals(LiveLogsConnection.Connecting, vm.state.value.connection)
            assertEquals(LiveLogsPhase.Loading, vm.state.value.phase)

            chunks.tryEmit(logFrame("{\"level\":\"warn\",\"message\":\"boom\",\"vehicle_id\":7}"))
            runCurrent()

            val state = vm.state.value
            assertEquals(LiveLogsConnection.Connected, state.connection)
            assertEquals(LiveLogsPhase.Content, state.phase)
            assertEquals(1, state.events.size)
            assertEquals("warn", state.events.first().level)
        }

    @Test
    fun vehicleFilterAppliesToLiveBuffer() =
        runTest(UnconfinedTestDispatcher()) {
            val chunks = MutableSharedFlow<String>(extraBufferCapacity = 16)
            val vm = viewModel(sourceOf(chunks))
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            chunks.tryEmit(logFrame("{\"level\":\"info\",\"message\":\"a\",\"vehicle_id\":7}"))
            runCurrent()
            assertEquals(1, vm.state.value.events.size)

            vm.setVehicleFilter("9")
            runCurrent()
            assertTrue(vm.state.value.events.isEmpty())
            assertEquals(LiveLogsPhase.Empty, vm.state.value.phase)
            assertEquals(1, vm.state.value.bufferedCount)
        }

    @Test
    fun pauseFreezesBufferAndClearEmptiesIt() =
        runTest(UnconfinedTestDispatcher()) {
            val chunks = MutableSharedFlow<String>(extraBufferCapacity = 16)
            val vm = viewModel(sourceOf(chunks))
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            chunks.tryEmit(logFrame("{\"level\":\"info\",\"message\":\"first\"}"))
            runCurrent()
            assertEquals(1, vm.state.value.events.size)

            vm.togglePause()
            runCurrent()
            chunks.tryEmit(logFrame("{\"level\":\"info\",\"message\":\"second\"}"))
            runCurrent()
            assertEquals(1, vm.state.value.events.size)
            assertEquals(LiveLogsConnection.Paused, vm.state.value.connection)

            vm.togglePause()
            vm.clear()
            runCurrent()
            assertEquals(0, vm.state.value.events.size)
            assertEquals(LiveLogsConnection.Connected, vm.state.value.connection)
        }

    // ── harness ─────────────────────────────────────────────────────────────────────────────────────────────

    /** A source bound to a controllable chunk [Flow], stamping a fixed clock for deterministic receipts. */
    private fun sourceOf(chunks: Flow<String>): LiveLogsSource = SseTransport { chunks }.asLiveLogsSource(nowMillis = { 0L })

    private fun TestScope.viewModel(
        source: LiveLogsSource,
        logger: Logger = NoopLogger,
    ): LiveLogsPageViewModel = LiveLogsPageViewModel(source, logger, backgroundScope)
}
