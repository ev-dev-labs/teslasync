package io.teslasync.android.dashboard.widgets.recentdrives

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.api.generated.Drive
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [RecentDrivesWidgetViewModel] over a controllable fake [RecentDrivesSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch), the default-vehicle resolution from the vehicles list
 * (web `vehicles?.[0]?.id`), the explicit-vehicle override, the empty-list gate (web `items.length > 0`),
 * and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RecentDrivesWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : RecentDrivesSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val driveEmissions = mutableMapOf<String, List<Resource<List<Drive>>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> =
            flow { (driveEmissions[vehicleId] ?: listOf(loadingDrives())).forEach { emit(it) } }
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
    fun loadingWhileVehiclesListLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenFirstVehicleHasDrives() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.driveEmissions["5"] = listOf(Resource.Success(listOf(drive(id = 1), drive(id = 2)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun emptyWhenNoVehiclesEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenDriveListIsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.driveEmissions["5"] = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the feed.
            src.driveEmissions["9"] = listOf(Resource.Success(listOf(drive(id = 1)), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenDrivesFailWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.driveEmissions["5"] = listOf(loadingDrives(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun hardErrorWhenVehiclesListFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(loadingVehicles(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun staleOfflineKeepsCachedDrivesWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            val cached = listOf(drive(id = 1))
            src.driveEmissions["5"] = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.driveEmissions["5"] = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedDrives() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.driveEmissions["5"] = listOf(Resource.Success(listOf(drive(id = 1)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val initial = vm.state.value
            assertEquals(1, initial.data?.size)

            src.driveEmissions["5"] = listOf(Resource.Success(listOf(drive(id = 1), drive(id = 2), drive(id = 3)), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val refreshed = vm.state.value
            assertEquals(3, refreshed.data?.size)
            assertEquals(200L, refreshed.fetchedAt)
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
            assertEquals(mapOf("surface" to "RecentDrivesWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutDrivePayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "recentDrives.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("distance_m") })
            assertFalse(logger.events.any { it.second.containsKey("vehicle_id") })
        }

    private fun TestScope.viewModel(
        source: RecentDrivesSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): RecentDrivesWidgetViewModel = RecentDrivesWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingDrives(): Resource<List<Drive>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
