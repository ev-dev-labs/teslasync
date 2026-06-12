package io.teslasync.android.featureviews.livesignaltail

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
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [LiveSignalTailViewModel] over a controllable fake [LiveSignalTailSource], covering the live-tail
 * behaviour the web `useLiveSignalStream` owns: the first frame baselines (the initial merged dump is never
 * replayed as a flood), subsequent scalar changes become newest-first rows, unchanged values produce
 * nothing, pause drops incoming rows (web `tailPaused`), clear empties the buffer (web `clearTail`), a
 * vehicle switch resets it, the rate decays as receipts age out, retry forwards to the shared stream, and
 * the PII-safe `view.opened` diagnostic fires exactly once. The infinite rate ticker means these tests step
 * virtual time with [runCurrent] / [advanceTimeBy] rather than `advanceUntilIdle`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalTailViewModelTest {
    private class FakeSource : LiveSignalTailSource {
        val feed = MutableSharedFlow<LiveSignalTailFrame>(replay = 1, extraBufferCapacity = 16)
        var reconnectCount = 0

        override fun frames(): Flow<LiveSignalTailFrame> = feed

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
    fun firstFrameBaselinesWithoutFloodingRows() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(60), "Gear" to JsonPrimitive("P"))))
            runCurrent()

            assertTrue(vm.bufferedEntries.isEmpty())
            assertEquals(LiveSignalTailBody.Empty, vm.state.value.body)
        }

    @Test
    fun changedScalarsBecomeNewestFirstRows() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(60))))
            runCurrent()
            src.feed.tryEmit(frame(5, linkedMapOf("Speed" to JsonPrimitive(64), "Gear" to JsonPrimitive("D"))))
            runCurrent()

            val entries = vm.bufferedEntries
            assertEquals(listOf("Speed", "Gear"), entries.map { it.name })
            assertEquals("64", entries.first().value)
            assertEquals(LiveSignalTailBody.Data, vm.state.value.body)
        }

    @Test
    fun unchangedValuesProduceNoRows() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(64))))
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(64))))
            runCurrent()

            assertTrue(vm.bufferedEntries.isEmpty())
        }

    @Test
    fun pauseDropsIncomingThenResumeShowsOnlyNewChanges() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(60))))
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(64))))
            runCurrent()
            assertEquals(1, vm.bufferedEntries.size)

            vm.togglePause()
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(70))))
            runCurrent()
            assertEquals(1, vm.bufferedEntries.size)
            assertTrue(vm.state.value.paused)

            vm.togglePause()
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(80))))
            runCurrent()
            val resumed = vm.bufferedEntries
            assertEquals(2, resumed.size)
            assertEquals("80", resumed.first().value)
        }

    @Test
    fun clearEmptiesTheBuffer() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(60))))
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(64))))
            runCurrent()
            assertEquals(1, vm.bufferedEntries.size)

            vm.clear()
            runCurrent()
            assertTrue(vm.bufferedEntries.isEmpty())
        }

    @Test
    fun vehicleSwitchResetsTheBuffer() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(60))))
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(64))))
            runCurrent()
            assertEquals(1, vm.bufferedEntries.size)

            src.feed.tryEmit(frame(7, mapOf("Speed" to JsonPrimitive(10))))
            runCurrent()
            assertTrue(vm.bufferedEntries.isEmpty())
        }

    @Test
    fun rateDecaysAsReceiptsAgeOutOfTheWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            var clock = 1_000L
            val vm = viewModel(src, clock = { clock })
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(60)), lastUpdated = 1_000L))
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(64)), lastUpdated = 1_000L))
            runCurrent()
            assertTrue(vm.state.value.rate >= 1)

            clock = 5_000L
            advanceTimeBy(600L)
            runCurrent()
            assertEquals(0, vm.state.value.rate)
        }

    @Test
    fun staleAndOfflineFlagsSurfaceWhileEntriesAreRetained() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            runCurrent()

            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(60))))
            runCurrent()
            src.feed.tryEmit(frame(5, mapOf("Speed" to JsonPrimitive(64)), isStale = true))
            runCurrent()

            assertTrue(vm.state.value.isStale)
            assertEquals(1, vm.bufferedEntries.size)
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
            assertEquals(mapOf("surface" to "LiveSignalTail"), opened.single().second)
        }

    @Test
    fun controlsEmitPiiSafeDiagnostics() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.togglePause()
            vm.clear()

            assertTrue(logger.events.any { it.first == "liveSignalTail.pauseToggle" })
            assertTrue(logger.events.any { it.first == "liveSignalTail.clear" })
            assertFalse(logger.events.any { it.second.containsKey("value") })
        }

    private fun TestScope.viewModel(
        source: LiveSignalTailSource,
        logger: Logger = NoopLogger,
        bufferMax: Int = DEFAULT_BUFFER_MAX,
        clock: () -> Long = { 0L },
    ): LiveSignalTailViewModel = LiveSignalTailViewModel(source, logger, bufferMax, clock, backgroundScope)

    /** Short, ktlint-friendly accessor for the buffered tail of the current state. */
    private val LiveSignalTailViewModel.bufferedEntries: List<LiveSignalEntry>
        get() = state.value.entries

    private companion object {
        fun frame(
            vehicleId: Long?,
            signals: Map<String, JsonElement>,
            status: LiveConnectionStatus = LiveConnectionStatus.Connected,
            isStale: Boolean = false,
            lastUpdated: Long? = 1_000L,
        ): LiveSignalTailFrame =
            LiveSignalTailFrame(
                vehicleId = vehicleId,
                signals = signals,
                lastUpdatedMillis = lastUpdated,
                status = status,
                isStale = isStale,
                lastMessageAtMillis = lastUpdated,
            )
    }
}
