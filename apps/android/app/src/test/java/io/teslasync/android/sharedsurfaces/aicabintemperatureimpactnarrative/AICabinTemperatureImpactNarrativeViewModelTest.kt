package io.teslasync.android.sharedsurfaces.aicabintemperatureimpactnarrative

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
 * Drives [AICabinTemperatureImpactNarrativeViewModel] over a controllable fake [AiNarrationStreamSource]
 * and the gate/vehicle seam flows, covering the full lifecycle the web component renders: the AI-Off gate,
 * vehicle-driven enablement, idle → streaming → done/error, cancel → idle, a terminal-frame-less close
 * marking done, the stale-on-vehicle-change reset, the no-op-while-disabled `narrate`, and the PII-safe
 * `view.opened` + narrate diagnostics — end to end through the real projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AICabinTemperatureImpactNarrativeViewModelTest {
    private class FakeStream(
        var events: List<AiNarrationEvent> = emptyList(),
        var hang: Boolean = false,
    ) : AiNarrationStreamSource {
        var lastVehicleId: Long? = null

        override fun narrate(vehicleId: Long): Flow<AiNarrationEvent> {
            lastVehicleId = vehicleId
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
            val vm = viewModel(FakeStream(), gate, vehicleFlow(1L))
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)

            gate.value = true
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    @Test
    fun vehicleResolutionEnablesStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vehicle = vehicleFlow(null)
            val vm = viewModel(FakeStream(), MutableStateFlow(true), vehicle)
            advanceUntilIdle()
            assertFalse(vm.state.value.canStart)

            vehicle.value = 7L
            advanceUntilIdle()
            assertEquals(7L, vm.state.value.vehicleId)
            assertTrue(vm.state.value.canStart)
        }

    @Test
    fun narrateStreamsToCompletedContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeStream(
                    events =
                        listOf(
                            AiNarrationEvent.Delta("Cabin runs best near 18 °C."),
                            AiNarrationEvent.Done("stop", 0, 0),
                        ),
                )
            val vm = viewModel(source, MutableStateFlow(true), vehicleFlow(1L))
            advanceUntilIdle()

            vm.narrate()
            advanceUntilIdle()

            assertEquals(NarrationPhase.Done, vm.state.value.phase)
            assertEquals("Cabin runs best near 18 °C.", vm.state.value.text)
            assertEquals(1L, source.lastVehicleId)
        }

    @Test
    fun streamClosingWithoutTerminalFrameMarksDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStream(events = listOf(AiNarrationEvent.Delta("partial")))
            val vm = viewModel(source, MutableStateFlow(true), vehicleFlow(1L))
            advanceUntilIdle()

            vm.narrate()
            advanceUntilIdle()

            assertEquals(NarrationPhase.Done, vm.state.value.phase)
            assertEquals("partial", vm.state.value.text)
        }

    @Test
    fun errorFrameProducesErrorState() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStream(events = listOf(AiNarrationEvent.Error(message = "boom")))
            val vm = viewModel(source, MutableStateFlow(true), vehicleFlow(1L))
            advanceUntilIdle()

            vm.narrate()
            advanceUntilIdle()

            assertEquals(NarrationPhase.Error, vm.state.value.phase)
            val error = vm.state.value.error
            assertEquals("boom", error?.message)
        }

    @Test
    fun cancelReturnsToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeStream(hang = true), MutableStateFlow(true), vehicleFlow(1L))
            advanceUntilIdle()

            vm.narrate()
            advanceUntilIdle()
            assertEquals(NarrationPhase.Streaming, vm.state.value.phase)

            vm.cancel()
            advanceUntilIdle()
            assertEquals(NarrationPhase.Idle, vm.state.value.phase)
        }

    @Test
    fun narrateIsNoopWhenGateOffOrNoVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val gateOff =
                viewModel(FakeStream(events = listOf(AiNarrationEvent.Delta("x"))), MutableStateFlow(false), vehicleFlow(1L), logger)
            advanceUntilIdle()
            gateOff.narrate()
            advanceUntilIdle()
            assertEquals(NarrationPhase.Idle, gateOff.state.value.phase)
            assertTrue(logger.events.none { it.first == "cabinTemperatureImpactNarrative.narrate" })

            val noVehicle =
                viewModel(FakeStream(events = listOf(AiNarrationEvent.Delta("x"))), MutableStateFlow(true), vehicleFlow(null))
            advanceUntilIdle()
            noVehicle.narrate()
            advanceUntilIdle()
            assertEquals(NarrationPhase.Idle, noVehicle.state.value.phase)
        }

    @Test
    fun vehicleChangeDiscardsStaleNarration() =
        runTest(UnconfinedTestDispatcher()) {
            val vehicle = vehicleFlow(1L)
            val source =
                FakeStream(events = listOf(AiNarrationEvent.Delta("for vehicle 1"), AiNarrationEvent.Done("stop", 0, 0)))
            val vm = viewModel(source, MutableStateFlow(true), vehicle)
            advanceUntilIdle()
            vm.narrate()
            advanceUntilIdle()
            assertEquals(NarrationPhase.Done, vm.state.value.phase)

            vehicle.value = 2L
            advanceUntilIdle()

            assertEquals(2L, vm.state.value.vehicleId)
            assertEquals(NarrationPhase.Idle, vm.state.value.phase)
            assertEquals("", vm.state.value.text)
        }

    @Test
    fun narrateEmitsDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeStream(), MutableStateFlow(true), vehicleFlow(1L), logger)
            advanceUntilIdle()

            vm.narrate()
            advanceUntilIdle()

            val narrate = logger.events.single { it.first == "cabinTemperatureImpactNarrative.narrate" }
            assertEquals(mapOf("surface" to "AICabinTemperatureImpactNarrative"), narrate.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeStream(), MutableStateFlow(true), vehicleFlow(1L), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "AICabinTemperatureImpactNarrative"), opened.single().second)
        }

    private fun vehicleFlow(id: Long?): MutableStateFlow<Long?> = MutableStateFlow(id)

    private fun TestScope.viewModel(
        source: AiNarrationStreamSource,
        gate: MutableStateFlow<Boolean>,
        vehicle: MutableStateFlow<Long?>,
        logger: Logger = NoopLogger,
    ): AICabinTemperatureImpactNarrativeViewModel =
        AICabinTemperatureImpactNarrativeViewModel(gate, vehicle, source, logger, backgroundScope)
}
