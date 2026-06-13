// Off-device unit tests for the AIPeriodCompareNarration state holder: the AI-feature gate, the vehicle ->
// canStart binding, the Period A / Period B window normalization + threading (0 kept, negatives dropped), the
// narrate-stream reduction (deltas -> done, unterminated -> done, terminal failure frame, thrown transport
// failure, offline last-known retention), the generate/retry actions and their in-flight guard, and the
// one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiperiodcomparenarration

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
class AIPeriodCompareNarrationViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIPeriodCompareNarrationViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(NarrationSurface.Hidden, classifyNarration(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIPeriodCompareNarrationViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setVehicleDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIPeriodCompareNarrationViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(7L)
            assertEquals(7L, vm.state.value.vehicleId)
            assertTrue(vm.state.value.canStart)
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    // ── Period A / Period B windows ─────────────────────────────────────────────────
    @Test
    fun generateThreadsVehicleAndWindows() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiNarrationChunk.Done))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setWindows(7, 30)
            vm.generate()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertEquals(7, source.lastDaysA)
            assertEquals(30, source.lastDaysB)
        }

    @Test
    fun setWindowsKeepsZeroAndDropsNegative() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiNarrationChunk.Done))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setWindows(0, -5)
            vm.generate()
            advanceUntilIdle()

            assertEquals(0, source.lastDaysA)
            assertNull(source.lastDaysB)
        }

    @Test
    fun generateWithoutWindowsThreadsNullHorizons() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiNarrationChunk.Done))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertNull(source.lastDaysA)
            assertNull(source.lastDaysB)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiNarrationChunk.Done))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(NarrationPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(NarrationPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiNarrationChunk.Failed(ErrorKind.Http)))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(NarrationPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(NarrationPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownNarration() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiNarrationChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(NarrationPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                NarrationSurface.Cached("known", offline = true),
                classifyNarration(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiNarrationChunk.Done))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.narrateCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.narrateCalls)
            assertEquals(NarrationPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiNarrationChunk.Done))))
            val vm = AIPeriodCompareNarrationViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()
            val before = source.narrateCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.narrateCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIPeriodCompareNarrationViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_PERIOD_COMPARE_NARRATION_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiNarrationChunk.Done))))
            val vm = AIPeriodCompareNarrationViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiPeriodCompareNarration.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiNarrationChunk = AiNarrationChunk.Delta(text)

    private data class Response(
        val chunks: List<AiNarrationChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIPeriodCompareNarrationSource {
        var narrateCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastDaysA: Int? = SENTINEL
            private set

        var lastDaysB: Int? = SENTINEL
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun narrate(
            vehicleId: Long,
            daysA: Int?,
            daysB: Int?,
        ): Flow<AiNarrationChunk> {
            val response = responses[narrateCalls.coerceAtMost(responses.lastIndex)]
            narrateCalls++
            lastVehicleId = vehicleId
            lastDaysA = daysA
            lastDaysB = daysB
            return flow {
                response.chunks.forEach { emit(it) }
                if (hold) awaitCancellation()
                response.error?.let { throw it }
            }
        }

        private companion object {
            // A value the normalized window can never take (normalizeDays yields null or >= 0), so an
            // unobserved thread is distinguishable from a real null/0 window.
            const val SENTINEL = -1
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
