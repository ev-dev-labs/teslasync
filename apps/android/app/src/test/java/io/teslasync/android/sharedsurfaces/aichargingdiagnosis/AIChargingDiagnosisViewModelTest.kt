// Off-device unit tests for the AIChargingDiagnosis state holder: the AI-feature gate, the session ->
// canStart binding, the diagnose-stream reduction (deltas -> done, unterminated -> done, terminal failure
// frame, thrown transport failure, offline last-known retention), the generate/retry actions and their
// in-flight guard, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the
// offline :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.aichargingdiagnosis

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
class AIChargingDiagnosisViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIChargingDiagnosisViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(DiagnosisSurface.Hidden, classifyDiagnosis(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIChargingDiagnosisViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── session / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setSessionDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIChargingDiagnosisViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            assertEquals("1023", vm.state.value.sessionId)
            assertTrue(vm.state.value.canStart)
            vm.setSession(null)
            assertFalse(vm.state.value.canStart)
            vm.setSession("")
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiStreamChunk.Done))))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DiagnosisPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()

            assertEquals(DiagnosisPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun generateThreadsSessionId() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("session-9")
            vm.generate()
            advanceUntilIdle()

            assertEquals("session-9", source.lastSessionId)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()

            assertEquals(DiagnosisPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()

            assertEquals(DiagnosisPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownDiagnosis() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DiagnosisPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                DiagnosisSurface.Cached("known", offline = true),
                classifyDiagnosis(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutSession() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.diagnoseCalls)
        }

    @Test
    fun generateIsNoOpWithEmptySession() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("")
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.diagnoseCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.diagnoseCalls)
            assertEquals(DiagnosisPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIChargingDiagnosisViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()
            val before = source.diagnoseCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.diagnoseCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIChargingDiagnosisViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_CHARGING_DIAGNOSIS_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIChargingDiagnosisViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setSession("1023")
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiChargingDiagnosis.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("session_id") })
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
    ) : AIChargingDiagnosisSource {
        var diagnoseCalls = 0
            private set

        var lastSessionId = ""
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun diagnose(sessionId: String): Flow<AiStreamChunk> {
            val response = responses[diagnoseCalls.coerceAtMost(responses.lastIndex)]
            diagnoseCalls++
            lastSessionId = sessionId
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
