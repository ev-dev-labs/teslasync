// Off-device unit tests for the AIPreheatPrecoolRecommender state holder: the AI-feature gate, the resolved
// inputs -> canStart binding, the deterministic inputs -> request body projection threaded to the source, the
// draft-stream reduction (deltas -> done, unterminated -> done, terminal failure frame, thrown transport
// failure, offline last-known retention), the generate/retry actions and their incomplete-inputs +
// in-flight guards, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the
// offline :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.aipreheatprecoolrecommender

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
class AIPreheatPrecoolRecommenderViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIPreheatPrecoolRecommenderViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(DraftSurface.Hidden, classifyDraft(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIPreheatPrecoolRecommenderViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── inputs / canStart ───────────────────────────────────────────────────────────
    @Test
    fun setInputsDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIPreheatPrecoolRecommenderViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            assertTrue(vm.state.value.canStart)
            vm.setInputs(PreheatDraftInputs(vehicleId = 1023L))
            assertFalse(vm.state.value.canStart)
            vm.setInputs(PreheatDraftInputs())
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Pre"), delta("heat"), AiStreamChunk.Done))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DraftPhase.Done, state.phase)
            assertEquals("Preheat", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun generateThreadsProjectedRequestBody() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            // Target omitted -> the projection must default it to 21 °C while passing the rest through.
            vm.setInputs(completeInputs(target = null))
            vm.generate()
            advanceUntilIdle()

            val body = source.lastBody
            assertEquals(
                PreheatDraftBody(
                    vehicleId = 1023L,
                    departBy = DEPART,
                    currentCabinTempC = 8.0,
                    outsideTempC = 4.0,
                    targetCabinTempC = DEFAULT_TARGET_CABIN_TEMP_C,
                ),
                body,
            )
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, vm.state.value.phase)
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
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DraftPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                DraftSurface.Cached("known", offline = true),
                classifyDraft(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutInputs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun generateIsNoOpWithIncompleteInputs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            // Vehicle + depart present, but the temperatures are missing -> canStart is false.
            vm.setInputs(PreheatDraftInputs(vehicleId = 1023L, departBy = DEPART))
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.draftCalls)
            assertEquals(DraftPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
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
            val vm = AIPreheatPrecoolRecommenderViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_PREHEAT_PRECOOL_RECOMMENDER_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIPreheatPrecoolRecommenderViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setInputs(completeInputs())
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiPreheatPrecoolRecommender.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("depart_by") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiStreamChunk = AiStreamChunk.Delta(text)

    private fun completeInputs(target: Double? = 21.0): PreheatDraftInputs =
        PreheatDraftInputs(
            vehicleId = 1023L,
            departBy = DEPART,
            currentCabinTempC = 8.0,
            outsideTempC = 4.0,
            targetCabinTempC = target,
        )

    private data class Response(
        val chunks: List<AiStreamChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIPreheatPrecoolRecommenderSource {
        var draftCalls = 0
            private set

        var lastBody: PreheatDraftBody? = null
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draft(body: PreheatDraftBody): Flow<AiStreamChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
            lastBody = body
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
        const val DEPART = "2026-06-13T07:30:00Z"
    }
}
