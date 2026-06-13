// Off-device unit tests for the AIAnomalyExplanations state holder: the AI-feature gate, the vehicle ->
// canStart binding, the explain-stream reduction (deltas -> done, unterminated -> done, terminal failure
// frame, thrown transport failure, offline last-known retention), the generate/retry actions and their
// in-flight guard, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the
// offline :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.aianomalyexplanations

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
class AIAnomalyExplanationsViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIAnomalyExplanationsViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(ExplanationSurface.Hidden, classifyExplanation(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIAnomalyExplanationsViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setVehicleDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIAnomalyExplanationsViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(7L)
            assertEquals(7L, vm.state.value.vehicleId)
            assertTrue(vm.state.value.canStart)
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiStreamChunk.Done))))
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(ExplanationPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ExplanationPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun generateThreadsVehicleAndWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertEquals(ANOMALY_EXPLANATION_WINDOW_DAYS, source.lastDays)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ExplanationPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ExplanationPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownExplanation() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(ExplanationPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                ExplanationSurface.Cached("known", offline = true),
                classifyExplanation(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.explainCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.explainCalls)
            assertEquals(ExplanationPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIAnomalyExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            val before = source.explainCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.explainCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIAnomalyExplanationsViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_ANOMALY_EXPLANATIONS_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIAnomalyExplanationsViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiAnomalyExplanations.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiStreamChunk = AiStreamChunk.Delta(text)

    private data class Response(
        val chunks: List<AiStreamChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIAnomalyExplanationsSource {
        var explainCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastDays = -1
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun explain(
            vehicleId: Long,
            days: Int,
        ): Flow<AiStreamChunk> {
            val response = responses[explainCalls.coerceAtMost(responses.lastIndex)]
            explainCalls++
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
