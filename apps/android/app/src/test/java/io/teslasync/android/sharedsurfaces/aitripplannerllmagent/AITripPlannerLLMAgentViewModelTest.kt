// Off-device unit tests for the AITripPlannerLLMAgent state holder: the AI-feature gate, the inputs ->
// canStart binding, the draft-stream reduction (deltas -> done, unterminated -> done, terminal failure frame,
// thrown transport failure, offline last-known retention), the draft/retry actions and their in-flight +
// incomplete-input guards, the request body threaded to the source, and the one-shot PII-safe `view.opened`
// diagnostic. Driven over a fake source; run by the offline :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.aitripplannerllmagent

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
class AITripPlannerLLMAgentViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AITripPlannerLLMAgentViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(TripPlanSurface.Hidden, classifyTripPlan(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AITripPlannerLLMAgentViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── inputs / canStart ────────────────────────────────────────────────────────────
    @Test
    fun setInputsDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AITripPlannerLLMAgentViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            assertTrue(vm.state.value.canStart)
            vm.setInputs(TripPlanInputs(vehicleId = VEHICLE_ID, origin = ORIGIN))
            assertFalse(vm.state.value.canStart)
            vm.setInputs(TripPlanInputs())
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiStreamChunk.Done))))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(TripPlanPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertEquals(TripPlanPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun generateThreadsResolvedRequestBody() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            val request = source.lastRequest
            assertEquals(completeInputs().toDraftRequest(), request)
            assertEquals(VEHICLE_ID, request?.vehicleId)
            assertEquals(DEFAULT_CURRENT_SOC, request?.currentSoc)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertEquals(TripPlanPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertEquals(TripPlanPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(TripPlanPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(TripPlanSurface.Cached("known", offline = true), classifyTripPlan(state, FIXED_NOW))
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutInputs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun generateIsNoOpWithIncompleteInputs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(TripPlanInputs(vehicleId = VEHICLE_ID, origin = ORIGIN))
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.draftCalls)
            assertEquals(TripPlanPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AITripPlannerLLMAgentViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()
            val before = source.draftCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.draftCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AITripPlannerLLMAgentViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_TRIP_PLANNER_LLM_AGENT_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutLeakingInputs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AITripPlannerLLMAgentViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiTripPlannerLLMAgent.draft" })
            val leakedKeys = setOf("vehicle_id", "vehicleId", "lat", "lng", "origin", "destination")
            assertNull(logger.records.firstOrNull { record -> record.fields.keys.any { it in leakedKeys } })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiStreamChunk = AiStreamChunk.Delta(text)

    private fun completeInputs(): TripPlanInputs = TripPlanInputs(vehicleId = VEHICLE_ID, origin = ORIGIN, destination = DESTINATION)

    private data class Response(
        val chunks: List<AiStreamChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AITripPlannerLLMAgentSource {
        var draftCalls = 0
            private set

        var lastRequest: TripPlanDraftRequest? = null
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draftPlan(request: TripPlanDraftRequest): Flow<AiStreamChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
            lastRequest = request
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
        const val VEHICLE_ID = 7L
        val ORIGIN = TripLocation(37.4419, -122.1430, "Palo Alto")
        val DESTINATION = TripLocation(34.0522, -118.2437, "Los Angeles")
    }
}
