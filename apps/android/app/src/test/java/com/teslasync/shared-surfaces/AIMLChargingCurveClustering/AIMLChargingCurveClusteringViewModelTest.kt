// Off-device unit tests for the AIMLChargingCurveClustering state holder: the AI-feature gate, the vehicle
// -> canStart binding, the cluster-stream reduction (deltas -> done, unterminated -> done, terminal failure
// frame, thrown transport failure, offline last-known retention), the train/retry actions and their
// in-flight guard, the 90-day lookback the request carries, and the one-shot PII-safe `view.opened`
// diagnostic. Driven over a fake source; run by the offline :app:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIMLChargingCurveClustering) cannot form a valid Kotlin package, so the
// package intentionally diverges from the path — exactly as the production sources and the sibling
// AIChargingCurveFingerprintClustering tests do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimlchargingcurveclustering

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
class AIMLChargingCurveClusteringViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIMLChargingCurveClusteringViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(ClusteringSurface.Hidden, classifyClustering(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIMLChargingCurveClusteringViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setVehicleDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIMLChargingCurveClusteringViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            assertEquals(1023L, vm.state.value.vehicleId)
            assertTrue(vm.state.value.canStart)
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiStreamChunk.Done))))
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(ClusterStreamPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ClusterStreamPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun generateThreadsVehicleAndDefaultLookback() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(77L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(77L, source.lastVehicleId)
            assertEquals(DEFAULT_LOOKBACK_DAYS, source.lastLookbackDays)
            assertEquals(90, source.lastLookbackDays)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ClusterStreamPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()

            assertEquals(ClusterStreamPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownNarrative() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(ClusterStreamPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                ClusteringSurface.Cached("known", offline = true),
                classifyClustering(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.clusterCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.clusterCalls)
            assertEquals(ClusterStreamPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIMLChargingCurveClusteringViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()
            val before = source.clusterCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.clusterCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIMLChargingCurveClusteringViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_ML_CHARGING_CURVE_CLUSTERING_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIMLChargingCurveClusteringViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1023L)
            vm.generate()
            advanceUntilIdle()

            val train = logger.records.filter { it.event == AIMLChargingCurveClusteringViewModel.EVENT_TRAIN }
            assertEquals(1, train.size)
            assertEquals(AI_ML_CHARGING_CURVE_CLUSTERING_SLUG, train.first().fields["slug"])
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
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
    ) : AIMLChargingCurveClusteringSource {
        var clusterCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastLookbackDays = -1
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun cluster(
            vehicleId: Long,
            lookbackDays: Int,
        ): Flow<AiStreamChunk> {
            val response = responses[clusterCalls.coerceAtMost(responses.lastIndex)]
            clusterCalls++
            lastVehicleId = vehicleId
            lastLookbackDays = lookbackDays
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
