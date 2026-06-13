package io.teslasync.android.sharedsurfaces.aisafetysettingexplainer

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [AISafetySettingExplainerViewModel] over a controllable fake [AiExplainStreamSource] and the
 * gate seam flow, covering the full lifecycle the web component renders: the AI-Off gate, idle →
 * streaming → done/error, cancel → idle, a terminal-frame-less close marking done, the no-op-while-disabled
 * `explain`, and the PII-safe `view.opened` + explain diagnostics — end to end through the real
 * projection. There is no vehicle dimension (the web body is `{}`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AISafetySettingExplainerViewModelTest {
    private class FakeStream(
        var events: List<AiExplainEvent> = emptyList(),
        var hang: Boolean = false,
    ) : AiExplainStreamSource {
        var calls: Int = 0

        override fun explain(): Flow<AiExplainEvent> {
            calls++
            return flow {
                events.forEach { emit(it) }
                if (hang) awaitCancellation()
            }
        }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun gateReflectsFlowAndHidesUntilEnabled() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = MutableStateFlow(false)
            val vm = viewModel(FakeStream(), gate)
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertFalse(vm.state.value.canStart)

            gate.value = true
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
            assertTrue(vm.state.value.canStart)
        }

    @Test
    fun explainStreamsToCompletedContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeStream(
                    events =
                        listOf(
                            AiExplainEvent.Delta("Sentry Mode is on; PIN to Drive is off."),
                            AiExplainEvent.Done("stop", 0, 0),
                        ),
                )
            val vm = viewModel(source, MutableStateFlow(true))
            advanceUntilIdle()

            vm.explain()
            advanceUntilIdle()

            assertEquals(ExplainPhase.Done, vm.state.value.phase)
            assertEquals("Sentry Mode is on; PIN to Drive is off.", vm.state.value.text)
            assertEquals(1, source.calls)
        }

    @Test
    fun streamClosingWithoutTerminalFrameMarksDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStream(events = listOf(AiExplainEvent.Delta("partial")))
            val vm = viewModel(source, MutableStateFlow(true))
            advanceUntilIdle()

            vm.explain()
            advanceUntilIdle()

            assertEquals(ExplainPhase.Done, vm.state.value.phase)
            assertEquals("partial", vm.state.value.text)
        }

    @Test
    fun errorFrameProducesErrorState() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStream(events = listOf(AiExplainEvent.Error(message = "boom")))
            val vm = viewModel(source, MutableStateFlow(true))
            advanceUntilIdle()

            vm.explain()
            advanceUntilIdle()

            assertEquals(ExplainPhase.Error, vm.state.value.phase)
            val error = vm.state.value.error
            assertEquals("boom", error?.message)
        }

    @Test
    fun cancelReturnsToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeStream(hang = true), MutableStateFlow(true))
            advanceUntilIdle()

            vm.explain()
            advanceUntilIdle()
            assertEquals(ExplainPhase.Streaming, vm.state.value.phase)

            vm.cancel()
            advanceUntilIdle()
            assertEquals(ExplainPhase.Idle, vm.state.value.phase)
        }

    @Test
    fun explainIsNoopWhenGateOff() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeStream(events = listOf(AiExplainEvent.Delta("x")))
            val vm = viewModel(source, MutableStateFlow(false), logger)
            advanceUntilIdle()

            vm.explain()
            advanceUntilIdle()

            assertEquals(ExplainPhase.Idle, vm.state.value.phase)
            assertEquals(0, source.calls)
            assertTrue(logger.events.none { it.first == "safetySettingExplainer.explain" })
        }

    @Test
    fun doubleExplainDoesNotRestartInflightStream() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStream(hang = true)
            val vm = viewModel(source, MutableStateFlow(true))
            advanceUntilIdle()

            vm.explain()
            advanceUntilIdle()
            assertEquals(ExplainPhase.Streaming, vm.state.value.phase)

            vm.explain()
            advanceUntilIdle()
            assertEquals(1, source.calls)
        }

    @Test
    fun explainEmitsDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeStream(), MutableStateFlow(true), logger)
            advanceUntilIdle()

            vm.explain()
            advanceUntilIdle()

            val explain = logger.events.single { it.first == "safetySettingExplainer.explain" }
            assertEquals(mapOf("surface" to "AISafetySettingExplainer"), explain.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeStream(), MutableStateFlow(true), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "AISafetySettingExplainer"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: AiExplainStreamSource,
        gate: MutableStateFlow<Boolean>,
        logger: Logger = NoopLogger,
    ): AISafetySettingExplainerViewModel = AISafetySettingExplainerViewModel(gate, source, logger, backgroundScope)
}
