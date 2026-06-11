package io.teslasync.android.data.vehicles

import io.teslasync.android.data.CommandPhase
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [VehicleDetailViewModel]: the detail tracks the app-wide selected vehicle (switching feeds via
 * `flatMapLatest`), and the wake command follows the confirm-then-run contract — success advances to
 * succeeded and refreshes the real vehicle state, while a failure surfaces the error kind and applies
 * no effect.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleDetailViewModelTest {
    private fun viewModel(
        repo: FakeVehiclesRepository,
        selection: SelectedVehicleStore,
        scope: CoroutineScope,
    ): VehicleDetailViewModel = VehicleDetailViewModel(VehiclesStore(repo, scope), selection, NoopLogger, scope)

    @Test
    fun detailIsLoadingWhenNoVehicleSelected() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeVehiclesRepository(), SelectedVehicleStore(), backgroundScope)
            backgroundScope.launch { vm.detail.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.detail.value.phase)
        }

    @Test
    fun detailTracksTheSelectedVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            repo.vehicleEmissions =
                listOf(
                    Resource.Loading(null, null, false),
                    Resource.Success(vehicle(5, "Roadster"), 100L, false),
                )
            val selection = SelectedVehicleStore()
            val vm = viewModel(repo, selection, backgroundScope)
            backgroundScope.launch { vm.detail.collect {} }
            selection.select(5L)
            advanceUntilIdle()

            val detail = vm.detail.value
            assertEquals(UiPhase.Content, detail.phase)
            assertEquals("Roadster", detail.data?.displayName)
        }

    @Test
    fun wakeConfirmSucceedsAndRefreshesTheVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            val selection = SelectedVehicleStore().also { it.select(5L) }
            val vm = viewModel(repo, selection, backgroundScope)

            vm.requestWake()
            assertTrue(vm.wake.value.isConfirming)
            vm.confirmWake()
            advanceUntilIdle()

            assertEquals(CommandPhase.Succeeded, vm.wake.value.phase)
            assertEquals(1, repo.wakeCalls)
            assertEquals(1, repo.refreshCalls)
        }

    @Test
    fun wakeConfirmFailureSurfacesErrorAndAppliesNoEffect() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            repo.wakeResult = Result.failure(ApiError.Http(status = 408))
            val selection = SelectedVehicleStore().also { it.select(5L) }
            val vm = viewModel(repo, selection, backgroundScope)

            vm.requestWake()
            vm.confirmWake()
            advanceUntilIdle()

            assertEquals(CommandPhase.Failed, vm.wake.value.phase)
            assertEquals(ErrorKind.Http, vm.wake.value.errorKind)
            assertEquals(0, repo.refreshCalls)
        }

    @Test
    fun wakeWithoutASelectedVehicleIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository()
            val vm = viewModel(repo, SelectedVehicleStore(), backgroundScope)

            vm.requestWake()
            vm.confirmWake()
            advanceUntilIdle()

            assertEquals(0, repo.wakeCalls)
        }
}
