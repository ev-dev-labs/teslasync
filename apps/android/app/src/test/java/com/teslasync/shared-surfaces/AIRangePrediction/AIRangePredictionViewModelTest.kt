// Off-device unit tests for the AIRangePrediction state holder: the AI-feature gate, the vehicle -> canStart
// binding, the training-window normalization + threading (default 14, clamped to mlrange.MaxDays), the
// train-stream reduction (deltas -> done, unterminated -> done, terminal failure frame, thrown transport
// failure, offline last-known retention), the train/retry actions and their in-flight guard, and the one-shot
// PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline :android:testReleaseUnitTest
// gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.airangeprediction

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
class AIRangePredictionViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIRangePredictionViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(RangeModelSurface.Hidden, classifyRangeModel(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIRangePredictionViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setVehicleDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIRangePredictionViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(7L)
            assertEquals(7L, vm.state.value.vehicleId)
            assertTrue(vm.state.value.canStart)
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    // ── training window ──────────────────────────────────────────────────────────────
    @Test
    fun trainThreadsVehicleAndDefaultsToWebFourteenDays() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.train()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertEquals(RANGE_MODEL_TRAINING_DAYS, source.lastDays)
        }

    @Test
    fun setTrainingWindowDaysThreadsResolvedWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setTrainingWindowDays(7)
            vm.train()
            advanceUntilIdle()

            assertEquals(7, source.lastDays)
        }

    @Test
    fun setTrainingWindowDaysClampsToServerMax() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setTrainingWindowDays(90)
            vm.train()
            advanceUntilIdle()

            assertEquals(RANGE_MODEL_MAX_DAYS, source.lastDays)
        }

    @Test
    fun setTrainingWindowDaysNullResetsToDefault() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setTrainingWindowDays(null)
            vm.train()
            advanceUntilIdle()

            assertEquals(RANGE_MODEL_TRAINING_DAYS, source.lastDays)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun trainAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(RangeModelPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun trainWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()

            assertEquals(RangeModelPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Failed(ErrorKind.Http)))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()

            assertEquals(RangeModelPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()

            assertEquals(RangeModelPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownNarration() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), RangeModelChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(RangeModelPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                RangeModelSurface.Cached("known", offline = true),
                classifyRangeModel(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun trainIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.train()
            advanceUntilIdle()
            assertEquals(0, source.trainCalls)
        }

    @Test
    fun trainIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()
            vm.train()
            advanceUntilIdle()

            assertEquals(1, source.trainCalls)
            assertEquals(RangeModelPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsTraining() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()
            val before = source.trainCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.trainCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIRangePredictionViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_RANGE_PREDICTION_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun trainEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(RangeModelChunk.Done))))
            val vm = AIRangePredictionViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.train()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiRangePrediction.train" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): RangeModelChunk = RangeModelChunk.Delta(text)

    private data class Response(
        val chunks: List<RangeModelChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIRangePredictionSource {
        var trainCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastDays = -1
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun train(
            vehicleId: Long,
            days: Int,
        ): Flow<RangeModelChunk> {
            val response = responses[trainCalls.coerceAtMost(responses.lastIndex)]
            trainCalls++
            lastVehicleId = vehicleId
            lastDays = days
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
