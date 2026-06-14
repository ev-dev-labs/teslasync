package io.teslasync.android.dashboard.widgets.climatehistory

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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [ClimateHistoryWidgetViewModel] over a controllable fake [ClimateHistorySource], covering the
 * full cache-then-network state matrix the web component renders — loading / content (chart) / empty
 * (no vehicle) / no-data content / hard error + retry / stale-offline + retry / refresh re-fetch — plus
 * the active-vehicle resolution (preferred id vs. first enrolled), the PII-safe `view.opened` diagnostic,
 * and the refresh event, end to end through the real [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClimateHistoryWidgetViewModelTest {
    private fun history(
        inside: Double,
        outside: Double = inside - 5,
    ): JsonElement =
        climateHistoryJson(
            listOf(ClimateRow(createdAt = "2024-06-11T08:00:00Z", insideTemp = inside, outsideTemp = outside)),
        )

    private class FakeSource(
        var vehicles: List<Resource<List<Vehicle>>>,
        var history: List<Resource<JsonElement>> = emptyList(),
    ) : ClimateHistorySource {
        var historyVehicleId: String? = null
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehicles.forEach { emit(it) } }

        override fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            flow {
                historyVehicleId = vehicleId
                history.forEach { emit(it) }
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
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(vehicles = listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNoVehicleEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(vehicles = listOf(success(emptyList()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertNotNull(state.data)
            assertFalse(state.data!!.hasData)
        }

    @Test
    fun contentWhenVehicleAndHistoryResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(7)))),
                    history = listOf(Resource.Success(history(inside = 22.0, outside = 15.0), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasData)
            assertEquals(22.0, data.samples.first().insideC!!, 0.0)
            assertEquals(100L, state.fetchedAt)
            assertEquals("7", src.historyVehicleId)
        }

    @Test
    fun vehicleWithEmptyHistoryIsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        vehicles = listOf(success(listOf(vehicle(7)))),
                        history = listOf(Resource.Success(emptyClimateHistoryJson(), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertFalse(state.data!!.hasData)
        }

    @Test
    fun loadingWhileHistoryLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        vehicles = listOf(success(listOf(vehicle(7)))),
                        history = listOf(Resource.Loading(null, null, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenHistoryFailsNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        vehicles = listOf(success(listOf(vehicle(7)))),
                        history = listOf(Resource.Error(null, null, false, ApiError.Network())),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedChartWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(7)))),
                    history = listOf(Resource.Success(history(inside = 22.0), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val initial = vm.state.value.data!!
            assertTrue(initial.hasData)

            src.history = listOf(Resource.Error(history(inside = 22.0), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.data!!.hasData)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedHistory() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(7)))),
                    history = listOf(Resource.Success(history(inside = 22.0), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = vm.state.value.data!!
            assertEquals(22.0, before.samples.first().insideC!!, 0.0)

            src.history = listOf(Resource.Success(history(inside = 26.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val after = vm.state.value.data!!
            assertEquals(26.0, after.samples.first().insideC!!, 0.0)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun preferredVehicleIdShortCircuitsFleetLookup() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(7)))),
                    history = listOf(Resource.Success(history(inside = 20.0), 100L, false)),
                )
            val vm = viewModel(src, vehicleId = 42L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals("42", src.historyVehicleId)
        }

    @Test
    fun recordViewOpenedEmitsSurfaceExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(vehicles = emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ClimateHistoryWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(vehicles = emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "climateHistory.refresh" })
        }

    private fun TestScope.viewModel(
        source: ClimateHistorySource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): ClimateHistoryWidgetViewModel = ClimateHistoryWidgetViewModel(source, logger, backgroundScope, vehicleId)

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
