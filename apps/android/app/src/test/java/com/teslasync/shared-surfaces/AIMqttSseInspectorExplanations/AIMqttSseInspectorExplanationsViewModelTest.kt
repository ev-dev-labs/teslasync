// Off-device unit tests for the AIMqttSseInspectorExplanations state holder: the AI-feature gate, the window ->
// canStart binding, the window threading into the explain request, the explain-stream reduction (deltas -> done,
// unterminated -> done, terminal failure frame, thrown transport failure, offline last-known retention), the
// generate/retry actions and their in-flight guard, and the one-shot PII-safe `view.opened` diagnostic. Driven
// over a fake source; run by the offline :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimqttsseinspectorexplanations

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
class AIMqttSseInspectorExplanationsViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIMqttSseInspectorExplanationsViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(ExplainerSurface.Hidden, classifyExplainer(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIMqttSseInspectorExplanationsViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── window / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setWindowDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIMqttSseInspectorExplanationsViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            assertEquals(ExplainerWindow(100L, 200L), vm.state.value.window)
            assertTrue(vm.state.value.canStart)
            vm.setWindow(200L, 100L)
            assertFalse(vm.state.value.canStart)
            vm.setWindow(null, null)
            assertFalse(vm.state.value.canStart)
        }

    @Test
    fun generateThreadsWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(ExplainerChunk.Done))))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(1_700_000_000L, 1_700_001_800L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(1_700_000_000L, source.lastFromUnix)
            assertEquals(1_700_001_800L, source.lastToUnix)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), ExplainerChunk.Done))))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(ExplainerPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ExplainerPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(ExplainerChunk.Failed(ErrorKind.Http)))))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ExplainerPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ExplainerPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownExplanation() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), ExplainerChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(ExplainerPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                ExplainerSurface.Cached("known", offline = true),
                classifyExplainer(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutValidWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(ExplainerChunk.Done))))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.explainCalls)

            vm.setWindow(200L, 100L)
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.explainCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.explainCalls)
            assertEquals(ExplainerPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(ExplainerChunk.Done))))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()
            val before = source.explainCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.explainCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIMqttSseInspectorExplanationsViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_MQTT_SSE_INSPECTOR_EXPLANATIONS_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(ExplainerChunk.Done))))
            val vm = AIMqttSseInspectorExplanationsViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setWindow(100L, 200L)
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiMqttSseInspectorExplanations.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("from_unix") })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("to_unix") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): ExplainerChunk = ExplainerChunk.Delta(text)

    private data class Response(
        val chunks: List<ExplainerChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIMqttSseInspectorExplanationsSource {
        var explainCalls = 0
            private set

        var lastFromUnix = -1L
            private set

        var lastToUnix = -1L
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun explain(
            fromUnix: Long,
            toUnix: Long,
        ): Flow<ExplainerChunk> {
            val response = responses[explainCalls.coerceAtMost(responses.lastIndex)]
            explainCalls++
            lastFromUnix = fromUnix
            lastToUnix = toUnix
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
