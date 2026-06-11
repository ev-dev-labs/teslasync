package io.teslasync.android.dashboard.widgets.energyflow

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [EnergyFlowWidgetViewModel] over a controllable fake [EnergyFlowSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic and the
 * refresh event — end to end through the real [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergyFlowWidgetViewModelTest {
    private val consuming = envelope(power = 24.6, batteryLevel = 72)
    private val charging = envelope(power = -4.0, isCharging = true, chargerPower = 11.0, batteryLevel = 64)
    private val emptyEnvelope = VehicleStateEnvelope(state = null, live = false)

    private class FakeSource(
        var stateEmissions: List<Resource<VehicleStateEnvelope>>,
        var vehicleEmissions: List<Resource<List<Vehicle>>> = listOf(Resource.Success(listOf(vehicle(1L)), 0L, false)),
    ) : EnergyFlowSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehicleEmissions.forEach { emit(it) } }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = flow { stateEmissions.forEach { emit(it) } }
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
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(consuming, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(consuming, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoVehicleState() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyEnvelope, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNoVehicleResolves() =
        runTest(UnconfinedTestDispatcher()) {
            // No explicit vehicle + an empty fleet list → the resource folds to a no-state success.
            val src =
                FakeSource(
                    stateEmissions = emptyList(),
                    vehicleEmissions = listOf(Resource.Success(emptyList(), 0L, false)),
                )
            val vm = viewModel(src, vehicleId = null)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(consuming, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(consuming, vm.state.value.data)

            src.stateEmissions = listOf(Resource.Error(consuming, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(consuming, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(consuming, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(consuming, vm.state.value.data)

            src.stateEmissions = listOf(Resource.Success(charging, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(charging, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "EnergyFlowWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "energyFlow.refresh" })
        }

    private fun TestScope.viewModel(
        source: EnergyFlowSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = 1L,
    ): EnergyFlowWidgetViewModel = EnergyFlowWidgetViewModel(source, logger, backgroundScope, vehicleId)

    private fun envelope(
        power: Double,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        batteryLevel: Long = 72,
    ): VehicleStateEnvelope =
        VehicleStateEnvelope(
            state =
                VehicleState(
                    batteryLevel = batteryLevel,
                    chargeRate = 0.0,
                    chargerPower = chargerPower,
                    idealRange = 300_000.0,
                    insideTemp = 21.0,
                    isCharging = isCharging,
                    isClimateOn = false,
                    isLocked = true,
                    latitude = 0.0,
                    longitude = 0.0,
                    odometer = 0.0,
                    outsideTemp = 10.0,
                    power = power,
                    ratedRange = 300_000.0,
                    sentryMode = false,
                    softwareVersion = "2026.4",
                    speed = 0.0,
                    state = "online",
                    timeToFullCharge = 0.0,
                    vehicleId = 1L,
                ),
            live = true,
        )

    private companion object {
        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochMilliseconds(0L),
                displayName = "Car $id",
                enrolledAt = Instant.fromEpochMilliseconds(0L),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochMilliseconds(0L),
                vin = "VIN$id",
            )
    }
}
