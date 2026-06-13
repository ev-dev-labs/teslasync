// Off-device unit tests for the AINLAlertBuilder state holder: the AI-feature gate, the vehicle + non-blank
// prompt -> canStart binding, the draft-stream reduction (deltas -> done, unterminated -> done, terminal
// failure frame, thrown transport failure, offline last-known retention), the generate/retry actions and their
// canStart + in-flight guards, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source;
// run by the offline :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlalertbuilder

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
class AINLAlertBuilderViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AINLAlertBuilderViewModel(
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
            val vm = AINLAlertBuilderViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle + prompt / canStart ───────────────────────────────────────────────
    @Test
    fun setVehicleAndPromptDriveCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AINLAlertBuilderViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(7L)
            assertFalse(vm.state.value.canStart)
            vm.setPrompt("spread > 50 mV")
            assertTrue(vm.state.value.canStart)
            vm.setPrompt("   ")
            assertFalse(vm.state.value.canStart)
            vm.setPrompt("spread > 50 mV")
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    @Test
    fun generateThreadsVehicleAndPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiDraftChunk.Done))))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setPrompt("alert me if cell voltage spread is over 50 mV")
            vm.generate()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertEquals("alert me if cell voltage spread is over 50 mV", source.lastPrompt)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Aler"), delta("tRule"), AiDraftChunk.Done))))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DraftPhase.Done, state.phase)
            assertEquals("AlertRule", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
            vm.generate()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiDraftChunk.Failed(ErrorKind.Http)))))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
            vm.generate()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
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
                            Response(listOf(delta("known"), AiDraftChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
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
    fun generateIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiDraftChunk.Done))))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("p")
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun generateIsNoOpWithBlankPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiDraftChunk.Done))))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("   ")
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
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
            val source = FakeSource(responses = listOf(Response(listOf(AiDraftChunk.Done))))
            val vm = AINLAlertBuilderViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
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
            val vm = AINLAlertBuilderViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_NL_ALERT_BUILDER_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiDraftChunk.Done))))
            val vm = AINLAlertBuilderViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setPrompt("p")
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiNLAlertBuilder.draft" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("prompt") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiDraftChunk = AiDraftChunk.Delta(text)

    private data class Response(
        val chunks: List<AiDraftChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AINLAlertBuilderSource {
        var draftCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastPrompt: String? = null
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draft(
            vehicleId: Long,
            prompt: String,
        ): Flow<AiDraftChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
            lastVehicleId = vehicleId
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
