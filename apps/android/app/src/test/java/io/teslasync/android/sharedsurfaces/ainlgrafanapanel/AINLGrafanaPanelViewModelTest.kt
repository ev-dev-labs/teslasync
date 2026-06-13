// Off-device unit tests for the AINLGrafanaPanel state holder: the AI-feature gate, the prompt -> canDraft
// binding, the draft-stream reduction (deltas + tool capture -> done, unterminated -> done, terminal failure
// frame, thrown transport failure, captured-then-failed offline retention), the draft/retry actions and their
// in-flight guard, and the one-shot PII-safe `view.opened` diagnostic (never the prompt text). Driven over a
// fake source; run by the offline :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.ainlgrafanapanel

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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AINLGrafanaPanelViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AINLGrafanaPanelViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(DraftSurface.Hidden, classifyGrafanaDraft(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AINLGrafanaPanelViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── prompt / canDraft ───────────────────────────────────────────────────────────
    @Test
    fun setPromptDrivesCanDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AINLGrafanaPanelViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("daily distance chart")
            assertEquals("daily distance chart", vm.state.value.prompt)
            assertTrue(vm.state.value.canDraft)
            vm.setPrompt("   ")
            assertFalse(vm.state.value.canDraft)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun draftAccumulatesDeltasAndCapturesDraftThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses = listOf(Response(listOf(delta("Map"), draftChunk(), delta("ped"), AiStreamChunk.Done))),
                )
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("show me a chart")
            vm.draft()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DraftPhase.Done, state.phase)
            assertEquals("Mapped", state.streamingText)
            assertNotNull(state.draft)
            assertEquals("Daily distance", state.draft?.panel?.title)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun draftWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(draftChunk()))))
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("chart")
            vm.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, vm.state.value.phase)
            assertNotNull(vm.state.value.draft)
        }

    @Test
    fun draftThreadsTrimmedPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("  hello chart  ")
            vm.draft()
            advanceUntilIdle()

            assertEquals("hello chart", source.lastPrompt)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("chart")
            vm.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("chart")
            vm.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsCapturedDraftAsOfflineCached() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(chunks = listOf(draftChunk()), error = ApiError.Network())))
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("chart")
            vm.draft()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DraftPhase.Failed, state.phase)
            assertNotNull(state.draft)
            assertEquals(
                DraftSurface.Cached(state.draft, "", offline = true),
                classifyGrafanaDraft(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun draftIsNoOpWithoutPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.draft()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun draftIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("chart")
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
            val vm = AINLGrafanaPanelViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("chart")
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
            val vm = AINLGrafanaPanelViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_NL_GRAFANA_PANEL_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun draftEmitsDiagnosticWithoutPromptText() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AINLGrafanaPanelViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("secret fleet query")
            vm.draft()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiNlGrafanaPanel.draft" })
            assertTrue(logger.records.none { record -> record.fields.values.any { it.contains("secret") } })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("prompt") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiStreamChunk = AiStreamChunk.Delta(text)

    private fun draftChunk(): AiStreamChunk = AiStreamChunk.ToolResult(DRAFT_GRAFANA_PANEL_TOOL, validPayload())

    private fun validPayload(): Map<String, Any?> =
        mapOf(
            "status" to "ok",
            "draft" to
                mapOf(
                    "prompt" to "p",
                    "rationale" to "r",
                    "panel" to
                        mapOf(
                            "title" to "Daily distance",
                            "type" to "timeseries",
                            "datasource" to mapOf("type" to "grafana-postgresql-datasource", "uid" to "uid-1"),
                            "targets" to listOf(mapOf("ref_id" to "A", "raw_sql" to "SELECT 1")),
                            "grid_pos" to mapOf("x" to 0, "y" to 0, "w" to 12, "h" to 8),
                        ),
                    "referenced_tables" to listOf("drives"),
                ),
        )

    private data class Response(
        val chunks: List<AiStreamChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AINLGrafanaPanelSource {
        var draftCalls = 0
            private set

        var lastPrompt = ""
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draft(prompt: String): Flow<AiStreamChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
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
