// Off-device unit tests for the AIIncidentTimelineSummarizer state holder: the AI-feature gate, the incident ->
// canStart binding (with the non-positive-id normalization), the summarize-stream reduction (deltas -> done,
// unterminated -> done, terminal failure frame, thrown transport failure, offline last-known retention), the
// generate/retry actions and their in-flight guard, and the one-shot PII-safe `view.opened` diagnostic. Driven
// over a fake source; run by the offline :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiincidenttimelinesummarizer

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
class AIIncidentTimelineSummarizerViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIIncidentTimelineSummarizerViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(SummarySurface.Hidden, classifySummary(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIIncidentTimelineSummarizerViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── incident / canStart ─────────────────────────────────────────────────────────
    @Test
    fun setIncidentDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIIncidentTimelineSummarizerViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(7L)
            assertEquals(7L, vm.state.value.incidentId)
            assertTrue(vm.state.value.canStart)
            vm.setIncident(null)
            assertFalse(vm.state.value.canStart)
        }

    @Test
    fun setIncidentNonPositiveNormalizesToDisabled() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIIncidentTimelineSummarizerViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(0L)
            assertNull(vm.state.value.incidentId)
            assertFalse(vm.state.value.canStart)
            vm.setIncident(-3L)
            assertNull(vm.state.value.incidentId)
        }

    @Test
    fun generateThreadsIncidentId() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(9L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(9L, source.lastIncidentId)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiSummaryChunk.Done))))
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(SummaryPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(SummaryPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Failed(ErrorKind.Http)))))
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(SummaryPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(SummaryPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownSummary() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiSummaryChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(SummaryPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                SummarySurface.Cached("known", offline = true),
                classifySummary(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutIncident() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.summarizeCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.summarizeCalls)
            assertEquals(SummaryPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AIIncidentTimelineSummarizerViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()
            val before = source.summarizeCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.summarizeCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIIncidentTimelineSummarizerViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_INCIDENT_TIMELINE_SUMMARIZER_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AIIncidentTimelineSummarizerViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setIncident(1L)
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiIncidentTimelineSummarizer.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("incident_id") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiSummaryChunk = AiSummaryChunk.Delta(text)

    private data class Response(
        val chunks: List<AiSummaryChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIIncidentTimelineSummarizerSource {
        var summarizeCalls = 0
            private set

        var lastIncidentId = -1L
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun summarize(incidentId: Long): Flow<AiSummaryChunk> {
            val response = responses[summarizeCalls.coerceAtMost(responses.lastIndex)]
            summarizeCalls++
            lastIncidentId = incidentId
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
