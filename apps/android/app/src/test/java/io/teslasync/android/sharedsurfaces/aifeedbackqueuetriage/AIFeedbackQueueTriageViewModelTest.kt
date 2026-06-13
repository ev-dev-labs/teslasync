// Off-device unit tests for the AIFeedbackQueueTriage state holder: the AI-feature gate, the feedbackId ->
// canStart binding, the draft-stream reduction (deltas -> done, unterminated -> done, terminal failure frame,
// thrown transport failure, offline last-known retention), the suggest/retry actions and their in-flight guard,
// and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.aifeedbackqueuetriage

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
class AIFeedbackQueueTriageViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIFeedbackQueueTriageViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(TriageSurface.Hidden, classifyTriage(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIFeedbackQueueTriageViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── feedbackId / canStart ───────────────────────────────────────────────────────
    @Test
    fun setFeedbackDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIFeedbackQueueTriageViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            assertEquals(4096L, vm.state.value.feedbackId)
            assertTrue(vm.state.value.canStart)
            vm.setFeedback(null)
            assertFalse(vm.state.value.canStart)
            vm.setFeedback(0L)
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun suggestAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiStreamChunk.Done))))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(TriagePhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun suggestWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
            advanceUntilIdle()

            assertEquals(TriagePhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun suggestThreadsFeedbackId() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(777L)
            vm.suggest()
            advanceUntilIdle()

            assertEquals(777L, source.lastFeedbackId)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
            advanceUntilIdle()

            assertEquals(TriagePhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
            advanceUntilIdle()

            assertEquals(TriagePhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownProposal() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(TriagePhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                TriageSurface.Cached("known", offline = true),
                classifyTriage(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun suggestIsNoOpWithoutFeedback() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.suggest()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun suggestIsNoOpWithNonPositiveFeedback() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(0L)
            vm.suggest()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun suggestIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
            advanceUntilIdle()
            vm.suggest()
            advanceUntilIdle()

            assertEquals(1, source.draftCalls)
            assertEquals(TriagePhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIFeedbackQueueTriageViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
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
            val vm = AIFeedbackQueueTriageViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_FEEDBACK_QUEUE_TRIAGE_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun suggestEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIFeedbackQueueTriageViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setFeedback(4096L)
            vm.suggest()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiFeedbackTriage.suggest" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("feedback_id") })
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
    ) : AIFeedbackQueueTriageSource {
        var draftCalls = 0
            private set

        var lastFeedbackId = 0L
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draftTriage(feedbackId: Long): Flow<AiStreamChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
            lastFeedbackId = feedbackId
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
