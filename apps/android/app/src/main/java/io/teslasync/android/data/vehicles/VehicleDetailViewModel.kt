package io.teslasync.android.data.vehicles

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.CommandRunner
import io.teslasync.android.data.CommandState
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * Page ViewModel for the active-vehicle detail surface. It is scoped to the app-wide selected vehicle:
 * the [SelectedVehicleStore.selectedId] drives a `flatMapLatest` that switches the shared
 * [VehiclesStore] `vehicle()` and `vehicleState()` feeds whenever the user changes vehicle — so the
 * detail always tracks the active selection without the screen knowing how selection is stored.
 *
 * It also owns the wake [CommandRunner] (the confirm-then-run command pattern, ADR-013): a command is
 * never cached as applied; [confirmWake] runs the shared `wakeVehicle` mutation through the
 * command-proxy and, on success, refreshes the vehicle feed so the UI reflects the real post-wake state.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleDetailViewModel(
    private val store: VehiclesStore,
    private val selection: SelectedVehicleStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    /** The selected vehicle's detail, switching feeds as the selection changes. */
    val detail: StateFlow<UiState<Vehicle>> =
        selection.selectedId
            .flatMapLatest { id -> if (id == null) loadingFeed<Vehicle>() else store.vehicle(id.toString()) }
            .asUiState()

    /** The selected vehicle's last-known state envelope (empty when the backend has no state yet). */
    val state: StateFlow<UiState<VehicleStateEnvelope>> =
        selection.selectedId
            .flatMapLatest { id -> if (id == null) loadingFeed<VehicleStateEnvelope>() else store.vehicleState(id) }
            .asUiState(isEmpty = { it.state == null })

    private val wakeRunner = CommandRunner("wake", stateScope, logger, onApplied = ::refresh)

    /** The wake command's confirm-then-run state (drives a confirm dialog + in-flight + outcome). */
    val wake: StateFlow<CommandState> = wakeRunner.state

    /** Asks for confirmation before waking the active vehicle. */
    fun requestWake() = wakeRunner.request()

    /** Dismisses a pending wake confirmation. */
    fun dismissWake() = wakeRunner.dismiss()

    /** Clears a shown wake outcome, returning the command control to idle. */
    fun resetWake() = wakeRunner.reset()

    /** Confirms and runs the wake command for the active vehicle (no-op when none is selected). */
    fun confirmWake() {
        val id = selection.selectedId.value ?: return
        wakeRunner.confirm { store.wakeVehicle(id) }
    }

    /** Re-fetches the active vehicle's detail + state (web `useRefreshVehicle`, refreshes the family). */
    fun refresh() {
        val id = selection.selectedId.value ?: return
        logger.info("vehicle.refresh")
        launch {
            val result = store.refreshVehicle(id.toString())
            result.onFailure { error -> logger.warn("vehicle.refresh.fail", mapOf("kind" to errorKindOf(error).name)) }
        }
    }

    private fun <T> loadingFeed(): Flow<Resource<T>> = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))
}
