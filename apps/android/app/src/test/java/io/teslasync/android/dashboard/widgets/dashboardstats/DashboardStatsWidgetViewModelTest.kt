package io.teslasync.android.dashboard.widgets.dashboardstats

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DashboardStats
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
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [DashboardStatsWidgetViewModel] over a controllable fake [DashboardStatsSource], covering the
 * cache-then-network state matrix the web component renders (loading / content / empty / stale-offline +
 * refresh re-fetch), the default-vehicle resolution from the vehicles list (web `vehicles?.[0]?.id`), the
 * explicit-vehicle override, the vehicle-independent primary summary (content without any vehicle), and the
 * PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardStatsWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : DashboardStatsSource {
        var statsEmissions: List<Resource<DashboardStats>> = listOf(loadingStats())
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val fsmEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()
        val timelineEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()

        override fun stats(): Flow<Resource<DashboardStats>> = flow { statsEmissions.forEach { emit(it) } }

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (fsmEmissions[vehicleId] ?: listOf(loadingJson())).forEach { emit(it) } }

        override fun stateTimeline(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (timelineEmissions[vehicleId] ?: listOf(Resource.Success(emptyTimeline(), 0L, false))).forEach { emit(it) } }
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
    fun loadingWhileStatsLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenSummaryResolvesWithoutAnyVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.statsEmissions = listOf(Resource.Success(stats(), 100L, false))
            // Vehicles never resolve: the summary is vehicle-independent and still drives the surface.
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(EM_DASH, state.data?.fsmState)
        }

    @Test
    fun contentWithResolvedVehicleParsesFsmState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.statsEmissions = listOf(Resource.Success(stats(), 100L, false))
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.fsmEmissions["5"] = listOf(Resource.Success(fsmJson("charging"), 200L, false))
            src.timelineEmissions["5"] = listOf(Resource.Success(emptyTimeline(), 150L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("charging", state.data?.fsmState)
            assertEquals(200L, state.fetchedAt)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.statsEmissions = listOf(Resource.Success(stats(), 100L, false))
            // Vehicles list never resolves; the explicit id must still drive the fsm feed.
            src.fsmEmissions["9"] = listOf(Resource.Success(fsmJson("asleep"), 120L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("asleep", state.data?.fsmState)
        }

    @Test
    fun emptyWhenStatsErrorsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.statsEmissions = listOf(loadingStats(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun staleOfflineKeepsCachedStatsAfterFailedRefresh() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val cached = stats()
            src.statsEmissions = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.statsEmissions = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshReFetchesUpdatedStats() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.statsEmissions = listOf(Resource.Success(stats(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.statsEmissions = listOf(Resource.Success(stats(), 300L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(300L, vm.state.value.fetchedAt)
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
            assertEquals(mapOf("surface" to "DashboardStatsWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutStatePayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "dashboardStats.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("state") })
            assertFalse(logger.events.any { it.second.containsKey("vehicle_id") })
        }

    private fun TestScope.viewModel(
        source: DashboardStatsSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): DashboardStatsWidgetViewModel = DashboardStatsWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun stats(): DashboardStats = DashboardStats(totalVehicles = 3, totalChargingSessions = 214, totalTrips = 1_286)

        fun loadingStats(): Resource<DashboardStats> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingJson(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun fsmJson(state: String): JsonElement = buildJsonObject { put("state", state) }

        fun emptyTimeline(): JsonElement = buildJsonObject { put("transitions", buildJsonArray { }) }

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
