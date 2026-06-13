// Tests [AIChargingCurveFingerprintClusteringViewModel] against scripted [AiExplainStream] seams plus the
// real [aiExplainStream] frame-assembly factory and the [ProcessAiExplainStream] install seam — covering
// every lifecycle the surface renders: the idle → streaming → done happy path with delta accumulation, a
// terminal error frame, a thrown transport error mapped to the error state (web fetch catch), a clean
// close with no terminal frame settling to done, the `canStart` gate (no explain without a vehicle), the
// request body's vehicle_id, double-submit coalescing (web `runningRef`), the PII-safe explain +
// `view.opened` diagnostics, the SSE chunk reassembly through the production factory, and the
// service-unavailable default the host overrides with [ProcessAiExplainStream.install]. The framework-free
// model is covered by AIChargingCurveFingerprintClusteringModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingcurvefingerprintclustering

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AIChargingCurveFingerprintClusteringViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    /** Captures the request + open count so coalescing and the body shape are asserted. */
    private class CapturingStream(
        private val inner: Flow<AiStreamFrame>,
    ) : AiExplainStream {
        var lastRequest: AiExplainRequest? = null
        var openCount: Int = 0

        override fun open(request: AiExplainRequest): Flow<AiStreamFrame> {
            lastRequest = request
            openCount += 1
            return inner
        }
    }

    private fun selectionWith(vehicleId: Long?): SelectedVehicleStore =
        SelectedVehicleStore().apply { if (vehicleId != null) select(vehicleId) }

    /** Builds the ViewModel and keeps its `WhileSubscribed` state live so `state.value` reflects updates. */
    private fun TestScope.viewModelOver(
        stream: AiExplainStream,
        selection: SelectedVehicleStore,
        logger: Logger = RecordingLogger(),
    ): AIChargingCurveFingerprintClusteringViewModel {
        val viewModel = AIChargingCurveFingerprintClusteringViewModel(stream, selection, logger, backgroundScope)
        backgroundScope.launch { viewModel.state.collect {} }
        return viewModel
    }

    @Test
    fun streamsIdleThenStreamingThenDoneAccumulatingDeltas() =
        runTest(UnconfinedTestDispatcher()) {
            val frames = MutableSharedFlow<AiStreamFrame>(extraBufferCapacity = 64)
            val viewModel = viewModelOver(AiExplainStream { frames }, selectionWith(7L))
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Idle, viewModel.state.value.phase)
            assertTrue(viewModel.state.value.canStart)

            viewModel.explain()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Streaming, viewModel.state.value.phase)

            frames.emit(AiStreamFrame.Delta("Cluster "))
            frames.emit(AiStreamFrame.Delta("A."))
            advanceUntilIdle()
            assertEquals("Cluster A.", viewModel.state.value.text)
            assertEquals(AiStreamPhase.Streaming, viewModel.state.value.phase)

            frames.emit(AiStreamFrame.Done)
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Done, viewModel.state.value.phase)
        }

    @Test
    fun terminalErrorFrameMovesToErrorState() =
        runTest(UnconfinedTestDispatcher()) {
            val stream = AiExplainStream { flowOf(AiStreamFrame.Error("stream_http_503")) }
            val viewModel = viewModelOver(stream, selectionWith(7L))
            advanceUntilIdle()

            viewModel.explain()
            advanceUntilIdle()

            assertEquals(AiStreamPhase.Error, viewModel.state.value.phase)
            assertEquals("stream_http_503", viewModel.state.value.error)
        }

    @Test
    fun thrownTransportErrorMapsToErrorState() =
        runTest(UnconfinedTestDispatcher()) {
            val stream = AiExplainStream { flow<AiStreamFrame> { throw IllegalStateException("kaboom") } }
            val viewModel = viewModelOver(stream, selectionWith(7L))
            advanceUntilIdle()

            viewModel.explain()
            advanceUntilIdle()

            assertEquals(AiStreamPhase.Error, viewModel.state.value.phase)
            assertEquals("kaboom", viewModel.state.value.error)
        }

    @Test
    fun cleanCloseWithoutTerminalFrameSettlesToDone() =
        runTest(UnconfinedTestDispatcher()) {
            // A finite stream that delivers a token then completes with no done/error frame (web "mark done").
            val viewModel = viewModelOver(AiExplainStream { flowOf(AiStreamFrame.Delta("partial")) }, selectionWith(7L))
            advanceUntilIdle()

            viewModel.explain()
            advanceUntilIdle()

            assertEquals(AiStreamPhase.Done, viewModel.state.value.phase)
            assertEquals("partial", viewModel.state.value.text)
        }

    @Test
    fun explainIsANoOpWhenNoVehicleIsInScope() =
        runTest(UnconfinedTestDispatcher()) {
            val stream = CapturingStream(flowOf(AiStreamFrame.Done))
            val viewModel = viewModelOver(stream, selectionWith(null))
            advanceUntilIdle()
            assertTrue(!viewModel.state.value.canStart)

            viewModel.explain()
            advanceUntilIdle()

            assertEquals(0, stream.openCount)
            assertEquals(AiStreamPhase.Idle, viewModel.state.value.phase)
        }

    @Test
    fun explainSendsTheSelectedVehicleIdInTheBody() =
        runTest(UnconfinedTestDispatcher()) {
            val stream = CapturingStream(flowOf(AiStreamFrame.Done))
            val viewModel = viewModelOver(stream, selectionWith(42L))
            advanceUntilIdle()

            viewModel.explain()
            advanceUntilIdle()

            assertEquals(AiExplainRequest(42L), stream.lastRequest)
        }

    @Test
    fun explainCoalescesADoubleSubmitWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val frames = MutableSharedFlow<AiStreamFrame>(extraBufferCapacity = 64)
            val stream = CapturingStream(frames)
            val viewModel = viewModelOver(stream, selectionWith(7L))
            advanceUntilIdle()

            viewModel.explain()
            advanceUntilIdle()
            // Second tap while the stream is open is a no-op (web `runningRef` coalescing).
            viewModel.explain()
            advanceUntilIdle()

            assertEquals(1, stream.openCount)
        }

    @Test
    fun explainLogsAPiiSafeDiagnosticWithoutVehicleId() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val stream = AiExplainStream { flowOf(AiStreamFrame.Done) }
            val viewModel = viewModelOver(stream, selectionWith(SELECTED_VEHICLE_ID), logger)
            advanceUntilIdle()

            viewModel.explain()
            advanceUntilIdle()

            val record = logger.records.single { it.event == "aiClustering.explain" }
            assertEquals(mapOf("surface" to "AIChargingCurveFingerprintClustering"), record.fields)
            // The vehicle id never reaches a diagnostics field.
            assertTrue(record.fields.values.none { it.contains(SELECTED_VEHICLE_STRING) })
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val viewModel = viewModelOver(AiExplainStream { flowOf(AiStreamFrame.Done) }, selectionWith(7L), logger)

            viewModel.onViewOpened()
            viewModel.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("AIChargingCurveFingerprintClustering", opened.first().fields["surface"])
        }

    // ── seam: the production factory + the host-installable process stream ────────

    @Test
    fun factoryAssemblesTypedFramesFromTransportChunks() =
        runTest {
            // A single chunk carrying two complete SSE frames.
            val transport = AiExplainTransport { flowOf("event: delta\ndata: {\"text\":\"hi\"}\n\nevent: done\ndata: {}\n\n") }
            val out = aiExplainStream(transport).open(AiExplainRequest(1L)).toList()
            assertEquals(listOf(AiStreamFrame.Delta("hi"), AiStreamFrame.Done), out)
        }

    @Test
    fun factoryReassemblesAFrameSplitAcrossChunks() =
        runTest {
            val transport = AiExplainTransport { flowOf("event: delta\ndata: {\"te", "xt\":\"hi\"}\n\n") }
            val out = aiExplainStream(transport).open(AiExplainRequest(1L)).toList()
            assertEquals(listOf(AiStreamFrame.Delta("hi")), out)
        }

    @Test
    fun processStreamIsUnavailableUntilTheHostInstallsATransport() =
        runTest {
            ProcessAiExplainStream.reset()
            assertEquals(
                listOf(AiStreamFrame.Error(STREAM_UNAVAILABLE_CODE)),
                ProcessAiExplainStream.open(AiExplainRequest(1L)).toList(),
            )

            ProcessAiExplainStream.install(AiExplainTransport { flowOf("event: done\ndata: {}\n\n") })
            assertEquals(listOf(AiStreamFrame.Done), ProcessAiExplainStream.open(AiExplainRequest(1L)).toList())

            ProcessAiExplainStream.reset()
            assertEquals(
                listOf(AiStreamFrame.Error(STREAM_UNAVAILABLE_CODE)),
                ProcessAiExplainStream.open(AiExplainRequest(1L)).toList(),
            )
        }

    @Test
    fun unavailableProcessStreamErrorProjectsToTheErrorPanel() {
        // The service-unavailable default error code projects to the surface's error panel (never blank).
        val panel = outputPanelStateFor(AiStreamPhase.Error, "", STREAM_UNAVAILABLE_CODE)
        assertEquals(OutputPanelState.Error(STREAM_UNAVAILABLE_CODE), panel)
    }

    private companion object {
        const val SELECTED_VEHICLE_ID = 98765L
        const val SELECTED_VEHICLE_STRING = "98765"
    }
}
