package io.teslasync.android.dashboard.widgets.drivingdynamics

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [DrivingDynamicsWidgetViewModel] over a controllable fake [DrivingDynamicsSource], covering the
 * full cache-then-network state matrix the web component renders (loading / content / empty / hard error
 * + retry / stale-offline + retry / refresh re-fetch), the default-vehicle resolution from the vehicles
 * list (web `vehicles?.[0]?.id`), the explicit-vehicle override, and the PII-safe `view.opened`
 * diagnostic — end to end through the real [io.teslasync.android.data.UiState] projection + the
 * dynamics-primary / distribution-best-effort combine.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DrivingDynamicsWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : DrivingDynamicsSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(Resource.Success(listOf(vehicle(1)), 1L, false))
        val dynamicsEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()
        val distributionEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun drivingDynamics(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (dynamicsEmissions[vehicleId] ?: listOf(loading())).forEach { emit(it) } }

        override fun accelerationDistribution(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (distributionEmissions[vehicleId] ?: listOf(Resource.Success(distJson(1.0, 2.0), 1L, false))).forEach { emit(it) } }
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
    fun loadingWhenDynamicsHasNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.dynamicsEmissions["7"] = listOf(loading())
            src.distributionEmissions["7"] = listOf(loading())
            val vm = viewModel(src, vehicleId = 7L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenDynamicsAndDistributionLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.dynamicsEmissions["7"] = listOf(Resource.Success(dynamicsJson(), 100L, false))
            src.distributionEmissions["7"] = listOf(Resource.Success(distJson(3.0, 5.0), 90L, false))
            val vm = viewModel(src, vehicleId = 7L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt) // web Math.max(dynUpdatedAt, distUpdatedAt)
            assertTrue(state.data?.dynamics is JsonObject)
        }

    @Test
    fun contentFromFirstVehicleWhenNoExplicitId() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.dynamicsEmissions["5"] = listOf(Resource.Success(dynamicsJson(), 100L, false))
            src.distributionEmissions["5"] = listOf(Resource.Success(distJson(1.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNoVehicleResolved() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 10L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenDynamicsPayloadNotAnObject() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.dynamicsEmissions["7"] = listOf(Resource.Success(JsonNull, 100L, false))
            src.distributionEmissions["7"] = listOf(Resource.Success(distJson(1.0), 100L, false))
            val vm = viewModel(src, vehicleId = 7L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenDynamicsErrorNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.dynamicsEmissions["7"] = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            src.distributionEmissions["7"] = listOf(Resource.Success(distJson(1.0), 100L, false))
            val vm = viewModel(src, vehicleId = 7L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedContentWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val dyn = dynamicsJson()
            src.dynamicsEmissions["7"] = listOf(Resource.Success(dyn, 100L, false), Resource.Error(dyn, 100L, true, ApiError.Timeout()))
            src.distributionEmissions["7"] = listOf(Resource.Success(distJson(1.0), 100L, false))
            val vm = viewModel(src, vehicleId = 7L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedDynamics() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.dynamicsEmissions["7"] = listOf(Resource.Success(dynamicsJson(maxAccel = 0.2), 100L, false))
            src.distributionEmissions["7"] = listOf(Resource.Success(distJson(1.0), 100L, false))
            val vm = viewModel(src, vehicleId = 7L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.dynamicsEmissions["7"] = listOf(Resource.Success(dynamicsJson(maxAccel = 0.9), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "DrivingDynamicsWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "drivingDynamics.refresh" })
        }

    private fun TestScope.viewModel(
        source: DrivingDynamicsSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): DrivingDynamicsWidgetViewModel = DrivingDynamicsWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun dynamicsJson(
            maxAccel: Double = 0.3,
            avgAccel: Double = 0.18,
        ): JsonElement =
            buildJsonObject {
                put("max_acceleration_g", maxAccel)
                put("max_braking_g", 0.25)
                put("max_cornering_g", 0.2)
                put("avg_acceleration_g", avgAccel)
                put("avg_braking_g", 0.12)
                put("smoothness_score", 70.0)
            }

        fun distJson(vararg values: Double): JsonElement =
            buildJsonObject {
                put(
                    "values",
                    buildJsonArray { values.forEach { add(it) } },
                )
            }

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
