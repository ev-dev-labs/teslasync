// Off-device unit tests for the AINLSqlPlayground state holder: the AI-feature gate, the prompt -> canStart
// binding, the draft-stream reduction (deltas -> done, the captured `draft_readonly_sql` draft enabling Apply,
// unterminated -> done, terminal failure frame, thrown transport failure, offline last-known retention,
// re-draft clearing the prior draft), the draft/retry actions and their prompt + in-flight guards, the trimmed
// prompt body, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.ainlsqlplayground

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
class AINLSqlPlaygroundViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AINLSqlPlaygroundViewModel(FakeSource(enabled = flowOf(false)), RecordingLogger(), backgroundScope, { FIXED_NOW })
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(SqlDraftSurface.Hidden, classifyDraft(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AINLSqlPlaygroundViewModel(FakeSource(), RecordingLogger(), backgroundScope, { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── prompt / canStart ─────────────────────────────────────────────────────────
    @Test
    fun setPromptDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AINLSqlPlaygroundViewModel(FakeSource(), RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("how many drives")
            assertTrue(vm.state.value.canStart)
            vm.setPrompt("   ")
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun draftAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("SEL"), delta("ECT"), AiStreamChunk.Done))))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("how many drives")
            vm.draft()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DraftPhase.Done, state.phase)
            assertEquals("SELECT", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun draftCapturesTypedDraftAndEnablesApply() =
        runTest(UnconfinedTestDispatcher()) {
            val draft = SqlDraft("how many drives", "SELECT 1", "counts", listOf("drives"))
            val source =
                FakeSource(
                    responses =
                        listOf(Response(listOf(delta("SELECT 1"), AiStreamChunk.DraftCaptured(draft), AiStreamChunk.Done))),
                )
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("how many drives")
            vm.draft()
            advanceUntilIdle()

            assertEquals(draft, vm.state.value.draft)
            assertTrue(vm.state.value.canApply)
        }

    @Test
    fun draftWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("q")
            vm.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun draftSendsTrimmedPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("   how many drives   ")
            vm.draft()
            advanceUntilIdle()

            assertEquals("how many drives", source.lastPrompt)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("q")
            vm.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("q")
            vm.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownText() =
        runTest(UnconfinedTestDispatcher()) {
            val draft = SqlDraft("q", "SELECT 1", "r", listOf("drives"))
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.DraftCaptured(draft), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("q")
            vm.draft()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DraftPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            // web `handleDraft` clears the prior draft before re-streaming, so a failed retry leaves no draft.
            assertNull(state.draft)
            assertEquals(SqlDraftSurface.Cached("known", offline = true), classifyDraft(state, FIXED_NOW))
        }

    @Test
    fun reDraftClearsPreviousDraftWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val draft = SqlDraft("q", "SELECT 1", "r", emptyList())
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(AiStreamChunk.DraftCaptured(draft), AiStreamChunk.Done)),
                            Response(listOf(delta("partial")), hold = true),
                        ),
                )
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("q")
            vm.draft()
            advanceUntilIdle()
            assertEquals(draft, vm.state.value.draft)

            vm.draft()
            advanceUntilIdle()
            assertNull(vm.state.value.draft)
            assertEquals(DraftPhase.Streaming, vm.state.value.phase)
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun draftIsNoOpWithoutPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.draft()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun draftIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")), hold = true)))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("q")
            vm.draft()
            advanceUntilIdle()
            vm.draft()
            advanceUntilIdle()

            assertEquals(1, source.draftCalls)
            assertEquals(DraftPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AINLSqlPlaygroundViewModel(source, RecordingLogger(), backgroundScope, { FIXED_NOW })
            vm.setPrompt("q")
            vm.draft()
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
            val vm = AINLSqlPlaygroundViewModel(FakeSource(), logger, backgroundScope, { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_NL_SQL_PLAYGROUND_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun draftEmitsDiagnosticWithoutPromptText() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AINLSqlPlaygroundViewModel(source, logger, backgroundScope, { FIXED_NOW })
            vm.setPrompt("how many drives")
            vm.draft()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiNlSqlPlayground.draft" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("prompt") })
            assertTrue(logger.records.none { record -> record.fields.values.any { it.contains("how many drives") } })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiStreamChunk = AiStreamChunk.Delta(text)

    private data class Response(
        val chunks: List<AiStreamChunk> = emptyList(),
        val error: Throwable? = null,
        val hold: Boolean = false,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
    ) : AINLSqlPlaygroundSource {
        var draftCalls = 0
            private set

        var lastPrompt = ""
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draftSql(prompt: String): Flow<AiStreamChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
            lastPrompt = prompt
            return flow {
                response.chunks.forEach { emit(it) }
                if (response.hold) awaitCancellation()
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
