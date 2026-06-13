// Drives [VehicleCardViewModel] over a fake [VehicleCardSource] — covering every state the web component's
// per-card `useVehicleState(vehicle.id)` query produces (loading / content / empty=asleep / hard error /
// offline-cached), the refresh + retry re-fetch, and the one-shot `view.opened` diagnostic. No Compose /
// Android / HTTP — runs in the offline :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecard

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VehicleCardViewModelTest {
    @Test
    fun loadsContentFromLiveState() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(successEnvelope(vehicleState(72)))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(72L, ui.data?.state?.batteryLevel)
        }

    @Test
    fun nullLiveStateIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(successEnvelope(state = null))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun firstLoadIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedStateWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        listOf(
                            Resource.Error(
                                cached = VehicleStateEnvelope(vehicleState(55), live = true),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(55L, ui.data?.state?.batteryLevel)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun refreshReCollectsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(successEnvelope(vehicleState(70))))
            val vm = VehicleCardViewModel(source, VEHICLE_ID, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.calls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.calls > before)
            assertTrue(logger.records.any { it.event == "vehicleCard.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(successEnvelope(vehicleState(70))))
            val vm = VehicleCardViewModel(source, VEHICLE_ID, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.calls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.calls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = VehicleCardViewModel(FakeSource(emptyList()), VEHICLE_ID, logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("VehicleCard", opened.first().fields["surface"])
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun TestScope.viewModel(source: FakeSource): VehicleCardViewModel =
        VehicleCardViewModel(source, VEHICLE_ID, RecordingLogger(), backgroundScope)

    private class FakeSource(
        private val emissions: List<Resource<VehicleStateEnvelope>>,
    ) : VehicleCardSource {
        var calls = 0
            private set

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> {
            calls++
            return emissions.asFlow()
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

    private fun successEnvelope(state: VehicleState?): Resource<VehicleStateEnvelope> =
        Resource.Success(VehicleStateEnvelope(state, live = state != null), fetchedAt = 100L, stale = false)

    private fun vehicleState(batteryLevel: Long): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 320_000.0,
            insideTemp = 20.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 10_000_000.0,
            outsideTemp = 10.0,
            power = 0.0,
            ratedRange = 300_000.0,
            sentryMode = false,
            softwareVersion = "2026.20.1",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = VEHICLE_ID,
        )

    private companion object {
        const val VEHICLE_ID = 1L
    }
}
