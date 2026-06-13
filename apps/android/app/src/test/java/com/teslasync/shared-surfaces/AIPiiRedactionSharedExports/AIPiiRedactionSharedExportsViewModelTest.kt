// Off-device unit tests for the AIPiiRedactionSharedExports state holder: the AI-feature gate, the non-blank
// export-type -> canStart binding, the plan-stream reduction (deltas -> done, unterminated -> done, terminal
// failure frame, thrown transport failure, offline last-known retention), the generate/retry actions and their
// canStart + in-flight guards, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source;
// run by the offline :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipiiredactionsharedexports

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
class AIPiiRedactionSharedExportsViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIPiiRedactionSharedExportsViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(RedactionSurface.Hidden, classifyRedaction(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIPiiRedactionSharedExportsViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── export type / canStart ──────────────────────────────────────────────────────
    @Test
    fun setExportTypeDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIPiiRedactionSharedExportsViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            assertFalse(vm.state.value.canStart)
            vm.setExportType("charging")
            assertTrue(vm.state.value.canStart)
            assertEquals("charging", vm.state.value.exportType)
        }

    @Test
    fun generateThreadsExportType() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiRedactionChunk.Done))))
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("analytics")
            vm.generate()
            advanceUntilIdle()

            assertEquals("analytics", source.lastExportType)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Redact "), delta("GPS"), AiRedactionChunk.Done))))
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(RedactionPhase.Done, state.phase)
            assertEquals("Redact GPS", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
            vm.generate()
            advanceUntilIdle()

            assertEquals(RedactionPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiRedactionChunk.Failed(ErrorKind.Http)))))
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
            vm.generate()
            advanceUntilIdle()

            assertEquals(RedactionPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
            vm.generate()
            advanceUntilIdle()

            assertEquals(RedactionPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownPlan() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiRedactionChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(RedactionPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                RedactionSurface.Cached("known", offline = true),
                classifyRedaction(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutAnExportType() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiRedactionChunk.Done))))
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.draftCalls)
            assertEquals(RedactionPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiRedactionChunk.Done))))
            val vm = AIPiiRedactionSharedExportsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
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
            val vm = AIPiiRedactionSharedExportsViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_PII_REDACTION_SHARED_EXPORTS_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutUserContent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiRedactionChunk.Done))))
            val vm = AIPiiRedactionSharedExportsViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setExportType("drives")
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiPiiRedactionSharedExports.plan" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("export_type") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiRedactionChunk = AiRedactionChunk.Delta(text)

    private data class Response(
        val chunks: List<AiRedactionChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIPiiRedactionSharedExportsSource {
        var draftCalls = 0
            private set

        var lastExportType: String? = null
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draft(exportType: String): Flow<AiRedactionChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
            lastExportType = exportType
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
