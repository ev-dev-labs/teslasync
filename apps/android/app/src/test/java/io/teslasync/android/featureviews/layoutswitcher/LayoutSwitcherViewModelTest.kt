package io.teslasync.android.featureviews.layoutswitcher

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [LayoutSwitcherViewModel] over a fake [LayoutSwitcherSource], plus the [resolveSelectedVehicle] +
 * [selectedVehicleResource] adapters directly — covering the web `useSelectedVehicle` resolution (preferred id
 * vs. first enrolled, the display-name/VIN label), every lifecycle state the bound vehicle feed produces
 * (loading / content / empty-fleet / hard error / offline-cached), the refresh + retry re-collect, and the
 * one-shot `view.opened` diagnostic. Run by the offline `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LayoutSwitcherViewModelTest {
    // ── resolveSelectedVehicle (web useSelectedVehicle resolution) ────────────────

    @Test
    fun resolveReturnsNoneForEmptyFleet() {
        assertEquals(SelectedVehicleContext.NONE, resolveSelectedVehicle(emptyList(), preferredVehicleId = null))
        assertEquals(SelectedVehicleContext.NONE, resolveSelectedVehicle(null, preferredVehicleId = 5L))
    }

    @Test
    fun resolvePrefersTheGivenVehicleWhenPresentElseFirst() {
        val fleet = listOf(vehicle(1, "Model 3"), vehicle(2, "Model Y"))
        assertEquals(SelectedVehicleContext(2L, "Model Y"), resolveSelectedVehicle(fleet, preferredVehicleId = 2L))
        // Preferred id not enrolled → first vehicle (web default).
        assertEquals(SelectedVehicleContext(1L, "Model 3"), resolveSelectedVehicle(fleet, preferredVehicleId = 99L))
        // No preference → first vehicle.
        assertEquals(SelectedVehicleContext(1L, "Model 3"), resolveSelectedVehicle(fleet, preferredVehicleId = null))
    }

    @Test
    fun resolveLabelFallsBackToVinWhenDisplayNameBlank() {
        val fleet = listOf(vehicle(1, displayName = "  ", vin = "5YJ3E1EA"))
        assertEquals(SelectedVehicleContext(1L, "5YJ3E1EA"), resolveSelectedVehicle(fleet, preferredVehicleId = null))
    }

    // ── selectedVehicleResource (lifecycle preservation) ──────────────────────────

    @Test
    fun adapterMapsSuccessToResolvedContext() =
        runTest {
            val result =
                selectedVehicleResource(flowOf(success(listOf(vehicle(7, "Roadster")))), preferredVehicleId = null)
                    .toList()
                    .last()
            assertTrue(result is Resource.Success)
            assertEquals(SelectedVehicleContext(7L, "Roadster"), result.cached)
        }

    @Test
    fun adapterMapsEmptyFleetToNoneContext() =
        runTest {
            val result = selectedVehicleResource(flowOf(success(emptyList())), preferredVehicleId = null).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(SelectedVehicleContext.NONE, result.cached)
        }

    @Test
    fun adapterPreservesLoadingAndError() =
        runTest {
            val loading =
                selectedVehicleResource(
                    flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                ).toList().last()
            assertTrue(loading is Resource.Loading)

            val error =
                selectedVehicleResource(
                    flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                ).toList().last()
            assertTrue(error is Resource.Error)
        }

    // ── ViewModel: state projection ───────────────────────────────────────────────

    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = LayoutSwitcherViewModel(FakeSource(listOf(success(listOf(vehicle(1, "Model 3"))))), RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(SelectedVehicleContext(1L, "Model 3"), ui.data)
        }

    @Test
    fun emptyFleetIsEmptyPhaseButStillCarriesNoneContext() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = LayoutSwitcherViewModel(FakeSource(listOf(success(emptyList()))), RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertFalse(
                vm.state.value.data
                    ?.hasVehicle ?: true,
            )
        }

    @Test
    fun fleetLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                LayoutSwitcherViewModel(
                    FakeSource(listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))),
                    RecordingLogger(),
                    backgroundScope,
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                LayoutSwitcherViewModel(
                    FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))),
                    RecordingLogger(),
                    backgroundScope,
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedVehicleWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                LayoutSwitcherViewModel(
                    FakeSource(
                        listOf(
                            Resource.Error(
                                cached = listOf(vehicle(1, "Model 3")),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                    ),
                    RecordingLogger(),
                    backgroundScope,
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(SelectedVehicleContext(1L, "Model 3"), ui.data)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun preferredVehicleIdResolvesThatVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                LayoutSwitcherViewModel(
                    FakeSource(listOf(success(listOf(vehicle(1, "Model 3"), vehicle(2, "Model Y"))))),
                    RecordingLogger(),
                    backgroundScope,
                    vehicleId = 2L,
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(SelectedVehicleContext(2L, "Model Y"), vm.state.value.data)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────

    @Test
    fun refreshReCollectsVehiclesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(success(listOf(vehicle(1, "Model 3")))))
            val vm = LayoutSwitcherViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.vehicleCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.vehicleCalls > before)
            assertTrue(logger.records.any { it.event == "layoutSwitcher.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1, "Model 3")))))
            val vm = LayoutSwitcherViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.vehicleCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.vehicleCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = LayoutSwitcherViewModel(FakeSource(emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("LayoutSwitcher", opened.first().fields["surface"])
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
    ) : LayoutSwitcherSource {
        var vehicleCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            vehicleCalls++
            return vehicles.asFlow()
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

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun vehicle(
        id: Long,
        displayName: String = "Car $id",
        vin: String = "VIN$id",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = displayName,
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = vin,
        )
}
