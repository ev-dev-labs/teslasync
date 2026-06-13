package io.teslasync.android.sharedsurfaces.vehiclemultiselect

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [VehicleMultiSelectViewModel] over a controllable fake [VehicleMultiSelectSource], covering the full
 * lifecycle the web component + the bound enrolled-vehicle feed render: a first load → loading, a resolved
 * fleet → content, an empty fleet → the disabled-trigger empty phase (web `isFleetEmpty`), a hard error →
 * error, a cached fleet after a failed refresh → the offline (stale + cached) surface, retry re-collecting the
 * source, and the PII-safe `view.opened` + `vehicleMultiSelect.refresh` diagnostics — end to end through the
 * real `toUiState` projection. The VM's `vehicles` is a `WhileSubscribed` feed, so each case keeps an active
 * collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleMultiSelectViewModelTest {
    private class FakeSource(
        initial: Resource<List<Vehicle>>,
    ) : VehicleMultiSelectSource {
        val flow = MutableStateFlow(initial)
        var calls: Int = 0

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            calls++
            return flow
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

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "5YJ3E1EA7KF00000$id",
        )

    @Test
    fun loadingResolvesToContentWhenTheFleetArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.vehicles.value.phase)

            source.flow.value = Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            val state = vm.vehicles.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data?.size)
        }

    @Test
    fun emptyFleetMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(emptyList(), fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.vehicles.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.vehicles.value.phase)
            assertNotNull(vm.vehicles.value.errorKind)
        }

    @Test
    fun errorWithCacheKeepsFleetAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = listOf(vehicle(1), vehicle(2))
            val source = FakeSource(Resource.Error(cached = cached, fetchedAt = STAMP, stale = true, error = RuntimeException("net")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.vehicles.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun retryReCollectsTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(1, source.calls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.calls)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false)), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "vehicleMultiSelect.refresh" }
            assertEquals(mapOf("surface" to "VehicleMultiSelect"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(emptyList(), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "VehicleMultiSelect"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: VehicleMultiSelectSource,
        logger: Logger = NoopLogger,
    ): VehicleMultiSelectViewModel = VehicleMultiSelectViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: VehicleMultiSelectViewModel) {
        backgroundScope.launch { vm.vehicles.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
