package io.teslasync.android.dashboard.widgets.sleepefficiency

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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [SleepEfficiencyWidgetViewModel] over a controllable fake [SleepEfficiencySource], covering the
 * full cache-then-network state matrix the web component renders (loading / content / empty / hard error
 * + retry / stale-offline + retry / refresh re-fetch), the default-vehicle resolution from the vehicles
 * list (web `vehicles?.[0]?.id`), the explicit-vehicle override, and the PII-safe `view.opened`
 * diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SleepEfficiencyWidgetViewModelTest {
    private val aCard = snapshot(efficiency = 92.0)

    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : SleepEfficiencySource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val sleepEmissions = mutableMapOf<Long, List<Resource<SleepEfficiencySnapshot?>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun sleepEfficiency(vehicleId: Long): Flow<Resource<SleepEfficiencySnapshot?>> =
            flow { (sleepEmissions[vehicleId] ?: listOf(loadingSleep())).forEach { emit(it) } }
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
    fun contentWhenFirstVehicleHasCard() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.sleepEmissions[5] = listOf(Resource.Success(aCard, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(92.0, state.data?.sleepEfficiencyPct ?: 0.0, EPS)
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
    fun emptyWhenCardBodyResolvesToNull() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.sleepEmissions[5] = listOf(Resource.Success<SleepEfficiencySnapshot?>(null, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the sleep feed.
            src.sleepEmissions[9] = listOf(Resource.Success(snapshot(efficiency = 99.0), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(99.0, state.data?.sleepEfficiencyPct ?: 0.0, EPS)
        }

    @Test
    fun hardErrorWithRetryWhenCardFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.sleepEmissions[5] = listOf(loadingSleep(), Resource.Error(null, null, false, ApiError.Network()))
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
    fun staleOfflineKeepsCachedCardWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.sleepEmissions[5] = listOf(Resource.Success(aCard, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.sleepEmissions[5] = listOf(Resource.Error(aCard, 100L, true, ApiError.Timeout()))
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
    fun refreshReFetchesUpdatedCard() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.sleepEmissions[5] = listOf(Resource.Success(snapshot(efficiency = 70.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val first = vm.state.value
            assertEquals(70.0, first.data?.sleepEfficiencyPct ?: 0.0, EPS)

            src.sleepEmissions[5] = listOf(Resource.Success(snapshot(efficiency = 98.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val updated = vm.state.value
            assertEquals(98.0, updated.data?.sleepEfficiencyPct ?: 0.0, EPS)
            assertEquals(200L, updated.fetchedAt)
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
            assertEquals(mapOf("surface" to "SleepEfficiencyWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEventWithoutCardPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "sleepEfficiency.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("efficiency") })
        }

    private fun TestScope.viewModel(
        source: SleepEfficiencySource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): SleepEfficiencyWidgetViewModel = SleepEfficiencyWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private fun snapshot(efficiency: Double): SleepEfficiencySnapshot =
        SleepEfficiencySnapshot(
            sleepEfficiencyPct = efficiency,
            sentryOffDrainRate = 0.1,
            stateDistribution = listOf(SleepStateBucket("asleep", 480.0)),
            recentEventCount = 2,
        )

    private companion object {
        const val EPS = 1e-9

        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingSleep(): Resource<SleepEfficiencySnapshot?> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

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
