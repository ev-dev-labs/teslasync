package io.teslasync.android.data.vehicles

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [VehiclesListViewModel] against the real shared [VehiclesStore] backed by [FakeVehiclesRepository]
 * — covering list content, the empty fleet, the self-healing selected-vehicle reconciliation, explicit
 * selection, and the sync mutation's one-shot success/failure outcome events.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclesListViewModelTest {
    private fun viewModel(
        repo: FakeVehiclesRepository,
        selection: SelectedVehicleStore,
        scope: kotlinx.coroutines.CoroutineScope,
    ): VehiclesListViewModel = VehiclesListViewModel(VehiclesStore(repo, scope), selection, NoopLogger, scope)

    @Test
    fun loadsVehicleListContent() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            repo.vehiclesEmissions =
                listOf(
                    Resource.Loading(null, null, false),
                    Resource.Success(listOf(vehicle(1), vehicle(2)), 100L, false),
                )
            val vm = viewModel(repo, SelectedVehicleStore(), backgroundScope)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()

            val state = vm.vehicles.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            repo.vehiclesEmissions =
                listOf(Resource.Loading(null, null, false), Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(repo, SelectedVehicleStore(), backgroundScope)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.vehicles.value.phase)
        }

    @Test
    fun selectionAutoReconcilesToFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            repo.vehiclesEmissions =
                listOf(
                    Resource.Loading(null, null, false),
                    Resource.Success(listOf(vehicle(7), vehicle(9)), 100L, false),
                )
            val selection = SelectedVehicleStore()
            val vm = viewModel(repo, selection, backgroundScope)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()

            assertEquals(7L, selection.selectedId.value)
            assertEquals(7L, vm.selectedId.value)
        }

    @Test
    fun selectUpdatesTheSharedSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val selection = SelectedVehicleStore()
            val vm = viewModel(FakeVehiclesRepository(), selection, backgroundScope)

            vm.select(42L)

            assertEquals(42L, vm.selectedId.value)
            assertEquals(42L, selection.selectedId.value)
        }

    @Test
    fun syncSuccessEmitsSuccessOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            val vm = viewModel(repo, SelectedVehicleStore(), backgroundScope)
            val events = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { events.add(it) } }

            vm.sync()
            advanceUntilIdle()

            assertEquals(1, repo.syncCalls)
            assertTrue(
                events.any { it is UiEvent.CommandOutcome && it.commandKey == "vehicles.sync" && it.success },
            )
        }

    @Test
    fun syncFailureEmitsFailureOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            repo.syncResult = Result.failure(ApiError.Network())
            val vm = viewModel(repo, SelectedVehicleStore(), backgroundScope)
            val events = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { events.add(it) } }

            vm.sync()
            advanceUntilIdle()

            assertTrue(events.any { it is UiEvent.CommandOutcome && !it.success })
        }
}
