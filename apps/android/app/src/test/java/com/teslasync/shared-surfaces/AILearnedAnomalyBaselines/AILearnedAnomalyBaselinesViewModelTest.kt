// Off-device unit tests for the AILearnedAnomalyBaselines state holder: the AI-feature gate, the vehicle ->
// canStart binding, the days-window normalization + threading (the data adapter's cached -> projection path),
// the train-stream reduction (deltas -> done, unterminated -> done, terminal failure frame, thrown transport
// failure, offline last-known retention), the generate/retry actions and their in-flight guard, and the
// one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailearnedanomalybaselines

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AILearnedAnomalyBaselinesViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AILearnedAnomalyBaselinesViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(BaselineSurface.Hidden, classifyBaseline(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AILearnedAnomalyBaselinesViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setVehicleDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AILearnedAnomalyBaselinesViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(7L)
            assertEquals(7L, vm.state.value.vehicleId)
            assertTrue(vm.state.value.canStart)
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    // ── days window (adapter cached -> projection) ───────────────────────────────────
    @Test
    fun generateThreadsVehicleAndDays() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiBaselineChunk.Done))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setDays(7)
            vm.generate()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertEquals(7, source.lastDays)
        }

    @Test
    fun setDaysNonPositiveThreadsDefaultWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiBaselineChunk.Done))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setDays(0)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ANOMALY_BASELINE_DEFAULT_DAYS, source.lastDays)
        }

    @Test
    fun generateWithoutSetDaysThreadsDefaultWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiBaselineChunk.Done))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertEquals(ANOMALY_BASELINE_DEFAULT_DAYS, source.lastDays)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiBaselineChunk.Done))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(TrainingPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(TrainingPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiBaselineChunk.Failed(ErrorKind.Http)))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(TrainingPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(TrainingPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownNarration() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiBaselineChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(TrainingPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                BaselineSurface.Cached("known", offline = true),
                classifyBaseline(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiBaselineChunk.Done))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.trainCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.trainCalls)
            assertEquals(TrainingPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiBaselineChunk.Done))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            val before = source.trainCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.trainCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AILearnedAnomalyBaselinesViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_LEARNED_ANOMALY_BASELINES_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiBaselineChunk.Done))))
            val vm = AILearnedAnomalyBaselinesViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiLearnedAnomalyBaselines.train" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiBaselineChunk = AiBaselineChunk.Delta(text)

    private data class Response(
        val chunks: List<AiBaselineChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AILearnedAnomalyBaselinesSource {
        var trainCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastDays: Int = -1
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun train(
            vehicleId: Long,
            days: Int,
        ): Flow<AiBaselineChunk> {
            val response = responses[trainCalls.coerceAtMost(responses.lastIndex)]
            trainCalls++
            lastVehicleId = vehicleId
            lastDays = days
            return flow {
                response.chunks.forEach { emit(it) }
                if (hold) awaitCancellation()
                response.error?.let { throw it }
            }
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

    private companion object {
        const val FIXED_NOW = 5_000L
    }
}
