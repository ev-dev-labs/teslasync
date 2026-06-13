// Off-device unit tests for the AILogTraceSummarization state holder: the AI-feature gate, the log-window ->
// canStart binding, the vehicle-id normalization + threading, the summarize-stream reduction (deltas -> done,
// unterminated -> done, terminal failure frame, thrown transport failure, offline last-known retention), the
// generate/retry actions and their window + in-flight guards, and the one-shot PII-safe `view.opened`
// diagnostic. Driven over a fake source; run by the offline :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailogtracesummarization

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
class AILogTraceSummarizationViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AILogTraceSummarizationViewModel(
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
            val vm = AILogTraceSummarizationViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── window / canStart ────────────────────────────────────────────────────────────
    @Test
    fun setWindowDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AILogTraceSummarizationViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
            assertEquals(FROM, vm.state.value.fromUnix)
            assertEquals(TO, vm.state.value.toUnix)
            assertTrue(vm.state.value.canStart)
            vm.setWindow(null, null)
            assertFalse(vm.state.value.canStart)
        }

    @Test
    fun setWindowOverTwentyFourHoursIsNotStartable() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AILogTraceSummarizationViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, FROM + MAX_LOG_WINDOW_SECONDS + 1L)
            assertFalse(vm.state.value.canStart)
        }

    // ── vehicle narrowing ────────────────────────────────────────────────────────────
    @Test
    fun generateThreadsWindowAndVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
            vm.setVehicle(9L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(FROM, source.lastFromUnix)
            assertEquals(TO, source.lastToUnix)
            assertEquals(9L, source.lastVehicleId)
        }

    @Test
    fun setVehicleNonPositiveThreadsNullVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
            vm.setVehicle(0L)
            vm.generate()
            advanceUntilIdle()

            assertNull(source.lastVehicleId)
        }

    @Test
    fun generateWithoutVehicleThreadsNullVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
            vm.generate()
            advanceUntilIdle()

            assertEquals(FROM, source.lastFromUnix)
            assertNull(source.lastVehicleId)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiSummaryChunk.Done))))
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
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
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
            vm.generate()
            advanceUntilIdle()

            assertEquals(SummaryPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Failed(ErrorKind.Http)))))
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
            vm.generate()
            advanceUntilIdle()

            assertEquals(SummaryPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
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
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
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
    fun generateIsNoOpWithoutAcceptableWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.summarizeCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
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
            val vm = AILogTraceSummarizationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
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
            val vm = AILogTraceSummarizationViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_LOG_TRACE_SUMMARIZATION_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiSummaryChunk.Done))))
            val vm = AILogTraceSummarizationViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(FROM, TO)
            vm.setVehicle(3L)
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiLogTraceSummarization.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("from_unix") })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("to_unix") })
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
    ) : AILogTraceSummarizationSource {
        var summarizeCalls = 0
            private set

        var lastFromUnix = -1L
            private set

        var lastToUnix = -1L
            private set

        var lastVehicleId: Long? = -1L
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun summarize(
            fromUnix: Long,
            toUnix: Long,
            vehicleId: Long?,
        ): Flow<AiSummaryChunk> {
            val response = responses[summarizeCalls.coerceAtMost(responses.lastIndex)]
            summarizeCalls++
            lastFromUnix = fromUnix
            lastToUnix = toUnix
            lastVehicleId = vehicleId
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

        /** A valid log-window start in Unix seconds. */
        const val FROM = 1_700_000_000L

        /** A valid 30-minute window end. */
        const val TO = FROM + 30L * 60L
    }
}
