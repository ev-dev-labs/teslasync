// Off-device unit tests for the AILifetimeStatsQA state holder: the AI-feature gate, the vehicle + question ->
// canStart binding, the question cap, the ask-stream reduction (deltas -> done, unterminated -> done, terminal
// failure frame, thrown transport failure, offline last-known retention), the ask/retry actions and their
// in-flight + missing-input guards, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake
// source; run by the offline :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailifetimestatsqa

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
class AILifetimeStatsQAViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AILifetimeStatsQAViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(QaSurface.Hidden, classifyQa(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AILifetimeStatsQAViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle + question / canStart ───────────────────────────────────────────────
    @Test
    fun setVehicleAndQuestionDriveCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AILifetimeStatsQAViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setQuestion("how far?")
            assertFalse(vm.state.value.canStart)
            vm.setVehicle(7L)
            assertTrue(vm.state.value.canStart)
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    @Test
    fun setQuestionCapsAtMax() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AILifetimeStatsQAViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setQuestion("a".repeat(MAX_QUESTION_CHARS + 100))
            assertEquals(MAX_QUESTION_CHARS, vm.state.value.question.length)
        }

    @Test
    fun askThreadsVehicleAndTrimmedQuestion() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiQaChunk.Done))))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setQuestion("  how far have I driven?  ")
            vm.ask()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertEquals("how far have I driven?", source.lastQuestion)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun askAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiQaChunk.Done))))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(QaPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun askWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()

            assertEquals(QaPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiQaChunk.Failed(ErrorKind.Http)))))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()

            assertEquals(QaPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()

            assertEquals(QaPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownAnswer() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiQaChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(QaPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                QaSurface.Cached("known", offline = true),
                classifyQa(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun askIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiQaChunk.Done))))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()
            assertEquals(0, source.askCalls)
        }

    @Test
    fun askIsNoOpWithoutQuestion() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiQaChunk.Done))))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.ask()
            advanceUntilIdle()
            assertEquals(0, source.askCalls)
        }

    @Test
    fun askIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()
            vm.ask()
            advanceUntilIdle()

            assertEquals(1, source.askCalls)
            assertEquals(QaPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsTheAsk() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiQaChunk.Done))))
            val vm = AILifetimeStatsQAViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("q")
            vm.ask()
            advanceUntilIdle()
            val before = source.askCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.askCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AILifetimeStatsQAViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_LIFETIME_STATS_QA_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun askEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiQaChunk.Done))))
            val vm = AILifetimeStatsQAViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setQuestion("how far have I driven?")
            vm.ask()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiLifetimeStatsQA.ask" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
            assertNull(logger.records.firstOrNull { record -> record.fields.values.any { it.contains("driven") } })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiQaChunk = AiQaChunk.Delta(text)

    private data class Response(
        val chunks: List<AiQaChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AILifetimeStatsQASource {
        var askCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastQuestion: String? = null
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun ask(
            vehicleId: Long,
            question: String,
        ): Flow<AiQaChunk> {
            val response = responses[askCalls.coerceAtMost(responses.lastIndex)]
            askCalls++
            lastVehicleId = vehicleId
            lastQuestion = question
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
