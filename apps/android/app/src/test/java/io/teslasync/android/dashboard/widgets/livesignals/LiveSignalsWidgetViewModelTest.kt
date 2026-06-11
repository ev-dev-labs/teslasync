package io.teslasync.android.dashboard.widgets.livesignals

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [LiveSignalsWidgetViewModel] over a controllable fake [LiveSignalsSource], covering the
 * cache-then-network state matrix the web component renders: the no-vehicle empty branch (web id≤0 ⇒
 * disabled queries), the default-vehicle resolution (web `vehicles?.[0]?.id`), the explicit-vehicle
 * override, the motor-feed-driven freshness (loading / error / stale-offline — web `WidgetShell` bound to
 * `useMotorLatest`), the four-feed section combine, the refresh re-fetch, and the PII-safe `view.opened`
 * diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalsWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : LiveSignalsSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val motorEmissions = mutableMapOf<Long, List<Resource<JsonElement>>>()
        val climateEmissions = mutableMapOf<Long, List<Resource<JsonElement>>>()
        val securityEmissions = mutableMapOf<Long, List<Resource<JsonElement>>>()
        val tireEmissions = mutableMapOf<Long, List<Resource<JsonElement>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = feed(motorEmissions, vehicleId)

        override fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>> = feed(climateEmissions, vehicleId)

        override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> = feed(securityEmissions, vehicleId)

        override fun tirePressureLatest(vehicleId: Long): Flow<Resource<JsonElement>> = feed(tireEmissions, vehicleId)

        private fun feed(
            emissions: Map<Long, List<Resource<JsonElement>>>,
            vehicleId: Long,
        ): Flow<Resource<JsonElement>> = flow { (emissions[vehicleId] ?: listOf(loadingJson())).forEach { emit(it) } }
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
    fun emptyWhileVehiclesListLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(LiveSignalsState.EMPTY, vm.state.value)
        }

    @Test
    fun emptyWhenNoVehiclesEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertNull(vm.state.value.motor)
            assertFalse(vm.state.value.isFetching)
        }

    @Test
    fun contentWhenFirstVehicleHasSignals() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.motorEmissions[5] = listOf(Resource.Success(sampleJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.motor)
            assertEquals(100L, state.updatedAtMillis)
            assertFalse(state.isFetching)
            assertFalse(state.isError)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the signal feeds.
            src.motorEmissions[9] = listOf(Resource.Success(sampleJson(), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertNotNull(vm.state.value.motor)
        }

    @Test
    fun motorFeedDrivesFetchingFreshness() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.motorEmissions[5] = listOf(loadingJson())
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isFetching)
            assertNull(vm.state.value.motor)
        }

    @Test
    fun motorFeedDrivesErrorFreshness() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.motorEmissions[5] = listOf(loadingJson(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            assertNull(vm.state.value.motor)
        }

    @Test
    fun staleOfflineKeepsCachedMotor() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.motorEmissions[5] = listOf(Resource.Error(sampleJson(), 100L, true, ApiError.Timeout()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.motor)
            assertTrue(state.isStale)
            assertTrue(state.isError)
            assertEquals(100L, state.updatedAtMillis)
        }

    @Test
    fun combinesAllFourSections() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.motorEmissions[5] = listOf(Resource.Success(sampleJson(), 100L, false))
            src.climateEmissions[5] = listOf(Resource.Success(sampleJson(), 100L, false))
            src.securityEmissions[5] = listOf(Resource.Success(sampleJson(), 100L, false))
            src.tireEmissions[5] = listOf(Resource.Success(sampleJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.motor)
            assertNotNull(state.climate)
            assertNotNull(state.security)
            assertNotNull(state.tires)
        }

    @Test
    fun refreshReFetchesSignals() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.motorEmissions[5] = listOf(Resource.Success(sampleJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.updatedAtMillis)

            src.motorEmissions[5] = listOf(Resource.Success(sampleJson(), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.updatedAtMillis)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "LiveSignalsWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "liveSignals.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("torque") })
        }

    private fun TestScope.viewModel(
        source: LiveSignalsSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): LiveSignalsWidgetViewModel = LiveSignalsWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingJson(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun sampleJson(): JsonElement = buildJsonObject { put("gear", "D") }

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = "Car $id",
                enrolledAt = Instant.fromEpochSeconds(0),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN$id",
            )
    }
}
