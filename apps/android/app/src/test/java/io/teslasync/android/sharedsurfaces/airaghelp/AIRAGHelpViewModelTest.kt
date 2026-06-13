// Off-device unit tests for the AIRAGHelp state holder: the AI-feature gate, the prompt -> canStart binding,
// the ask-stream reduction (deltas -> done, unterminated -> done, terminal failure frame, thrown transport
// failure, offline last-known retention), the ask/retry actions and their in-flight + blank-prompt guards, the
// captured-prompt contract, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run
// by the offline :app:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.airaghelp

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
class AIRAGHelpViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIRAGHelpViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(HelpAnswerSurface.Hidden, classifyHelpAnswer(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIRAGHelpViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── prompt / canStart ───────────────────────────────────────────────────────────
    @Test
    fun setPromptDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIRAGHelpViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("How do I enable forecasting?")
            assertEquals("How do I enable forecasting?", vm.state.value.prompt)
            assertTrue(vm.state.value.canStart)
            vm.setPrompt("   ")
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun askAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Open "), delta("Settings"), AiStreamChunk.Done))))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("q")
            vm.ask()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(HelpAnswerPhase.Done, state.phase)
            assertEquals("Open Settings", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun askWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("q")
            vm.ask()
            advanceUntilIdle()

            assertEquals(HelpAnswerPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun askThreadsTheCurrentPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("How do I export drives?")
            vm.ask()
            advanceUntilIdle()

            assertEquals("How do I export drives?", source.lastPrompt)
        }

    @Test
    fun askCapturesPromptAtStartSoLaterEditsDoNotMutateInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("first question")
            vm.ask()
            advanceUntilIdle()
            // Editing the prompt mid-stream must not change the request already in flight (web pins body).
            vm.setPrompt("second question")
            advanceUntilIdle()

            assertEquals("first question", source.lastPrompt)
            assertEquals("second question", vm.state.value.prompt)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("q")
            vm.ask()
            advanceUntilIdle()

            assertEquals(HelpAnswerPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("q")
            vm.ask()
            advanceUntilIdle()

            assertEquals(HelpAnswerPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownAnswer() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("q")
            vm.ask()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(HelpAnswerPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                HelpAnswerSurface.Cached("known", offline = true),
                classifyHelpAnswer(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun askIsNoOpWithoutPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.ask()
            advanceUntilIdle()
            assertEquals(0, source.askCalls)
        }

    @Test
    fun askIsNoOpWithBlankPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("   ")
            vm.ask()
            advanceUntilIdle()
            assertEquals(0, source.askCalls)
        }

    @Test
    fun askIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("q")
            vm.ask()
            advanceUntilIdle()
            vm.ask()
            advanceUntilIdle()

            assertEquals(1, source.askCalls)
            assertEquals(HelpAnswerPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsTheQuery() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIRAGHelpViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("q")
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
            val vm = AIRAGHelpViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_RAG_HELP_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun askEmitsDiagnosticWithoutLeakingPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIRAGHelpViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("a secret question about my fleet")
            vm.ask()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiRagHelp.ask" })
            // The prompt text must never appear in any structured field (PII-safe diagnostics).
            assertNull(logger.records.firstOrNull { it.fields.containsKey("prompt") })
            assertTrue(logger.records.none { it.fields.values.any { v -> v.contains("secret") } })
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
    ) : AIRAGHelpSource {
        var askCalls = 0
            private set

        var lastPrompt = ""
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun ask(prompt: String): Flow<AiStreamChunk> {
            val response = responses[askCalls.coerceAtMost(responses.lastIndex)]
            askCalls++
            lastPrompt = prompt
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
