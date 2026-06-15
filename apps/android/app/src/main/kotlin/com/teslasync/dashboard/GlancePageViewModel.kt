// The state holder backing the GlancePage dashboard surface (P1/S8) — the native counterpart of the web page's
// React state + four TanStack-Query hooks (web/src/features/dashboard/pages/GlancePage.tsx). It projects the
// `useVehicles` list feed onto the shared lifecycle-aware [UiState] surface (loading → empty → success → error,
// plus stale/offline), resolving the target vehicle (web `vehicleId ?? vehicles?.[0]`) and folding the
// per-vehicle `useVehicleState` + `useLocationSnapshotLatest` reads into a single [GlanceSnapshot] the page
// renders. It also owns the command-dispatch side (web `useVehicleCommand`): the single [sendCommand] action and
// the [activeCommand] in-flight flag that disables every quick-action and spins the running one. All derivation
// logic lives in the framework-free model (GlancePageModel.kt); this holder is the thin orchestration layer and
// performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.glance

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real shared Vehicles + Vehicle-command holders + the app selection ↔ test
 *   fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, command, and `refresh`
 *   events. Command names are not PII.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GlancePageViewModel(
    private val source: GlancePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableActiveCommand = MutableStateFlow<String?>(null)
    private var viewOpenedRecorded = false

    /**
     * The resolved page snapshot as a lifecycle-aware [UiState]: loading (first vehicle-list load) → empty (no
     * enrolled vehicle, web `!vehicle` branch) → content (a vehicle resolved, with its state + location folded
     * in) → error (hard list failure), plus stale/offline. Re-collected whenever the active vehicle changes (web
     * vehicle resolution) or the refresh trigger bumps. The per-vehicle state/location are secondary reads whose
     * absence shows em-dash metrics + a muted gauge, exactly as the web page renders them.
     */
    val uiState: StateFlow<UiState<GlanceSnapshot>> =
        combine(refreshTrigger, source.selectedVehicleId()) { _, selectedId -> selectedId }
            .flatMapLatest { selectedId ->
                source.vehicles().flatMapLatest { vehiclesResource ->
                    val vehicle = resolveGlanceVehicle(vehiclesResource.cached, selectedId)
                    if (vehicle == null) {
                        flowOf(glanceResource(vehiclesResource, vehicle = null, state = null, location = null, stateFetchedAt = null))
                    } else {
                        combine(
                            source.vehicleState(vehicle.id),
                            source.locationSnapshotLatest(vehicle.id),
                        ) { stateResource, locationResource ->
                            glanceResource(
                                vehicles = vehiclesResource,
                                vehicle = vehicle,
                                state = stateResource.cached?.state,
                                location = locationResource.cached,
                                stateFetchedAt = resourceFetchedAt(stateResource),
                            )
                        }
                    }
                }
            }
            .asUiState(isEmpty = { it.vehicle == null })

    /**
     * The command currently in flight, or `null` (web `sendCommand.isPending` + `sendCommand.variables.command`).
     * While non-null every quick-action is disabled and the matching one shows a spinner.
     */
    val activeCommand: StateFlow<String?> = mutableActiveCommand.asStateFlow()

    /**
     * Dispatch [command] to the resolved vehicle (web `sendCommand.mutate`). No-op when no vehicle is resolved
     * (web `vehicleId` is `0`) or while another command is in flight. Sets [activeCommand] for the duration, then
     * — on settle — clears it and emits the terminal [UiEvent.CommandOutcome] (the data-behavior analogue of the
     * web hook's success/error toast). The command goes through the shared repository; only the real backend
     * [Result] advances state (ADR-013: commands are not optimistically applied), and on success the repository
     * invalidates the vehicle-state cache so the gauge/metrics re-fetch the post-command truth.
     */
    fun sendCommand(command: String) {
        val vehicleId = uiState.value.data?.vehicle?.id ?: 0L
        if (vehicleId <= 0L || mutableActiveCommand.value != null) return
        mutableActiveCommand.value = command
        logger.info("glance.command.send", mapOf("command" to command))
        launch {
            val outcome = source.sendCommand(vehicleId, command)
            mutableActiveCommand.value = null
            outcome.fold(
                onSuccess = { result ->
                    emitEvent(UiEvent.CommandOutcome(commandKey = command, success = result.success))
                    logger.info(if (result.success) "glance.command.ok" else "glance.command.rejected")
                },
                onFailure = { error ->
                    emitEvent(UiEvent.CommandOutcome(commandKey = command, success = false))
                    logger.warn("glance.command.fail", mapOf("kind" to errorKindOf(error).name))
                },
            )
        }
    }

    /** Re-collect the reads — the web queries' `refetch` / the page error-surface retry affordance. */
    fun refresh() {
        logger.info("glance.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the vehicle-list feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGlancePageOpened(logger)
    }

    companion object {
        /**
         * Wire the surface from the shared [VehiclesStore] + [VehicleCommandStore] (P1/S8) and the app-wide
         * active-vehicle selection ([selectedVehicleStore]). The holder runs on `viewModelScope`; a custom scope
         * is a test-only concern handled via the constructor.
         */
        fun create(
            vehiclesStore: VehiclesStore,
            vehicleCommandStore: VehicleCommandStore,
            selectedVehicleStore: SelectedVehicleStore,
            logger: Logger,
        ): GlancePageViewModel =
            GlancePageViewModel(
                source = glancePageSourceOf(vehiclesStore, vehicleCommandStore, selectedVehicleStore),
                logger = logger,
            )
    }
}
