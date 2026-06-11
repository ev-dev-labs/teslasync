package io.teslasync.android.data.vehicles

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * Page ViewModel for the enrolled-vehicle list. Binds the shared [VehiclesStore] `vehicles()` feed
 * (the KMP port of the web `useVehicles` hook) to a lifecycle-aware [UiState] and bridges row taps to
 * the app-scoped [SelectedVehicleStore] so every vehicle-scoped screen follows the same active vehicle.
 *
 * It owns no networking. [sync] is the "Sync vehicles" mutation (web `useSyncVehicles`): it
 * re-discovers from Tesla and refreshes the `['vehicles']` family, which re-fetches this list. The
 * outcome is surfaced as a one-shot [UiEvent] for a toast, never cached as if applied (ADR-013).
 */
class VehiclesListViewModel(
    private val store: VehiclesStore,
    private val selection: SelectedVehicleStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    /** The enrolled-vehicle list as cache-then-network UI state (empty fleet -> empty phase). */
    val vehicles: StateFlow<UiState<List<Vehicle>>> = store.vehicles().asUiState()

    /** The currently-selected vehicle id (shared app-wide), for highlighting the active row. */
    val selectedId: StateFlow<Long?> = selection.selectedId

    init {
        // Self-heal the app-wide selection from the live list: keep a valid choice, else auto-pick the
        // first vehicle, else clear when the fleet is empty (the web "default to first vehicle" behaviour).
        launch {
            store.vehicles().collect { resource ->
                resource.cached?.let { list -> selection.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /** Selects [id] as the active vehicle for the vehicle-scoped screens. */
    fun select(id: Long) {
        selection.select(id)
        logger.info("vehicles.select")
    }

    /** Re-discovers vehicles from Tesla and refreshes the list (web "Sync vehicles"); emits an outcome. */
    fun sync() {
        logger.info("vehicles.sync.start")
        launch {
            store.syncVehicles().fold(
                onSuccess = { emitEvent(UiEvent.CommandOutcome(commandKey = "vehicles.sync", success = true)) },
                onFailure = { error ->
                    logger.warn("vehicles.sync.fail", mapOf("kind" to errorKindOf(error).name))
                    emitEvent(UiEvent.CommandOutcome(commandKey = "vehicles.sync", success = false))
                },
            )
        }
    }
}
