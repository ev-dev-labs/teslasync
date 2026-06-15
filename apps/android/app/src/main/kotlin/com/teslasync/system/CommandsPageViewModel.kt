// The state holder backing the CommandsPage surface (P1/S8) — the native counterpart of the web page's two
// TanStack-Query reads (web/src/features/system/pages/CommandsPage.tsx): `useQuery(['vehicles'])` and the
// per-vehicle `useQuery(['command-vehicle-states', …])` map. It projects the `useVehicles` list feed onto the
// shared lifecycle-aware [UiState] surface (loading → empty → success → error, plus stale/offline) and folds each
// vehicle's `/vehicles/{id}/state` read into the resolved [CommandsSnapshot] the page renders (the four-card fleet
// roll-up + the per-vehicle rows the command centers consume). All derivation logic lives in the framework-free
// model (CommandsPageModel.kt); this holder is the thin orchestration layer and performs no HTTP. The per-vehicle
// command-latest feed + the command dispatcher are bound by each embedded VehicleCommandCenter through the source,
// not here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.commands

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real shared Vehicles + Commands + Vehicle-command holders ↔ test fake); the
 *   view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandsPageViewModel(
    private val source: CommandsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The resolved page snapshot as a lifecycle-aware [UiState]: loading (first vehicle-list load) → empty (no
     * enrolled vehicle, web `!vehicles?.length` branch) → content (vehicles resolved, each with its per-vehicle
     * state folded in) → error (hard list failure), plus stale/offline. Re-collected whenever the refresh trigger
     * bumps. The per-vehicle state reads are secondary: a still-loading or hard-errored one yields a `null` state
     * for that vehicle (web `states[v.id] ?? null`), and any hard-errored read raises [CommandsSnapshot.statesError]
     * (web `statesError`, which drives the GlassPanel5 banner). The online/asleep roll-up is derived from these
     * per-vehicle states because the generated `Vehicle` carries no inline `state` field.
     */
    val uiState: StateFlow<UiState<CommandsSnapshot>> =
        refreshTrigger
            .flatMapLatest {
                source.vehicles().flatMapLatest { vehiclesResource ->
                    val vehicles = vehiclesResource.cached ?: emptyList()
                    if (vehicles.isEmpty()) {
                        flowOf(commandsSnapshotResource(vehiclesResource, rows = emptyList(), statesError = false))
                    } else {
                        combine(vehicles.map { vehicle -> source.vehicleState(vehicle.id) }) { stateResources ->
                            val rows =
                                vehicles.mapIndexed { index, vehicle ->
                                    CommandsVehicleRow(vehicle = vehicle, state = stateResources[index].cached?.state)
                                }
                            val statesError = stateResources.any { it is Resource.Error && it.cached == null }
                            commandsSnapshotResource(vehiclesResource, rows = rows, statesError = statesError)
                        }
                    }
                }
            }
            .asUiState(isEmpty = { !it.hasVehicles })

    /** Re-collect the reads — the web queries' `refetch` / the page error-surface retry affordance. */
    fun refresh() {
        logger.info("commands.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the vehicle-list feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCommandsPageOpened(logger)
    }

    companion object {
        /** Wire the surface from a host-supplied [source]. The holder runs on `viewModelScope`. */
        fun create(
            source: CommandsPageSource,
            logger: Logger,
        ): CommandsPageViewModel = CommandsPageViewModel(source = source, logger = logger)
    }
}
