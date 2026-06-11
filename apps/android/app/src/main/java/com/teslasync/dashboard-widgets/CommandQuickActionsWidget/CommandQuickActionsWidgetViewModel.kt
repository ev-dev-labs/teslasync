// UI-thread-free state holder backing the Command Quick Actions widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx). It
// binds the resolved-scope feed (P1/S8) through [CommandQuickActionsSource], projects each
// cache-then-network emission onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), and owns the command-dispatch side of the surface: the single [sendCommand] action
// (web `useVehicleCommand` mutation), the [activeCommand] in-flight flag (web `activeCommand` state that
// disables every button + spins the running one), the refresh action, and the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] / [activeCommand] and calls
// [sendCommand] / [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CommandQuickActionsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.commandquickactions

import io.teslasync.android.data.BaseFeedViewModel
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
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network resolved-scope seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param commander the command-dispatch seam (web `useVehicleCommand`); a fake in tests.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, `send`,
 *   command-outcome + `refresh` events. Command names are not PII.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandQuickActionsWidgetViewModel(
    source: CommandQuickActionsSource,
    private val commander: CommandQuickActionsCommander,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false
    private val mutableActiveCommand = MutableStateFlow<String?>(null)

    /**
     * The resolved-scope feed as a lifecycle-aware [UiState]: loading / content (a vehicle resolved) /
     * empty (no vehicle) / stale / offline / error, carrying the freshness stamp + error kind. Empty
     * mirrors the web `id ? grid : <EmptyState>` gate.
     */
    val state: StateFlow<UiState<CommandQuickActionsSnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { !it.hasVehicle })

    /**
     * The command currently in flight, or `null` (web `activeCommand`). While non-null every button is
     * disabled and the matching one shows a spinner (web `disabled={!!activeCommand}` + the `Loader2`).
     */
    val activeCommand: StateFlow<String?> = mutableActiveCommand.asStateFlow()

    /**
     * Dispatches [command] to the resolved vehicle (web `handleCommand`). No-op when no vehicle is
     * resolved (web `if (!id) return`) or while another command is in flight (web disables every button
     * via `activeCommand`). Sets [activeCommand] for the duration, then — on settle — clears it and emits
     * the terminal [UiEvent.CommandOutcome] so the host surfaces the web `toast.success`/`toast.error`.
     * The command goes through the shared repository; only the real backend [Result] advances state
     * (ADR-013: commands are not optimistically applied).
     */
    fun sendCommand(command: String) {
        val vehicleId = state.value.data?.vehicleId ?: 0L
        if (vehicleId <= 0L || mutableActiveCommand.value != null) return
        mutableActiveCommand.value = command
        logger.info("commandQuickActions.send", mapOf("command" to command))
        launch {
            val outcome = commander.send(vehicleId, command)
            mutableActiveCommand.value = null
            outcome.fold(
                onSuccess = { result ->
                    emitEvent(UiEvent.CommandOutcome(commandKey = command, success = result.success))
                    logger.info(if (result.success) "commandQuickActions.ok" else "commandQuickActions.rejected")
                },
                onFailure = { error ->
                    emitEvent(UiEvent.CommandOutcome(commandKey = command, success = false))
                    logger.warn("commandQuickActions.fail", mapOf("kind" to errorKindOf(error).name))
                },
            )
        }
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("commandQuickActions.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id or command, so a diagnostics line can never leak fleet data. Call
     * from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to CommandQuickActionsRegistration.SLUG))
    }

    companion object {
        /**
         * Wire the surface from the shared [VehiclesStore] + [VehicleCommandStore] (P1/S8) and the
         * app-wide active-vehicle selection ([activeVehicleId], typically
         * `SelectedVehicleStore.selectedId`). An explicit [vehicleId] overrides the active selection (web
         * `vehicleId` prop precedence). The holder runs on `viewModelScope`; a custom scope is a
         * test-only concern handled via the constructor.
         */
        fun create(
            vehiclesStore: VehiclesStore,
            vehicleCommandStore: VehicleCommandStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
        ): CommandQuickActionsWidgetViewModel =
            CommandQuickActionsWidgetViewModel(
                source = StoreCommandQuickActionsSource(vehiclesStore, activeVehicleId, vehicleId),
                commander = StoreCommandQuickActionsCommander(vehicleCommandStore),
                logger = logger,
            )
    }
}
