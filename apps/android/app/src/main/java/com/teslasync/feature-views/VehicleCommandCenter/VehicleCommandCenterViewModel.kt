// UI-thread-free state holder backing the VehicleCommandCenter — the native port of the web component's
// data hooks (web/src/features/system/components/VehicleCommandCenter.tsx). It binds the latest-command
// feed (P1/S8) through [CommandLatestSource], projects each cache-then-network emission onto the shared
// [UiState] surface (loading / content / empty / stale / offline / error — the freshness chrome over the
// always-present command grid), and owns the command-dispatch side of the surface: the single
// [executeCommand] action (web `useVehicleCommand` + `wakeMut` mutations), the [inFlightCommand] flag (web
// `isLoading = cmd.isPending || wakeMut.isPending`, which disables every tile + spins the running one), the
// [lastResult] feedback panel (web `lastResult` — set for generic commands, not for wake), the refresh
// action (web `queryClient` invalidation), and the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] / [inFlightCommand] / [lastResult] and calls [executeCommand] /
// [refresh] / [recordViewOpened], and consumes the one-shot [events] for the success/error toast.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject

/**
 * @param vehicleId the target vehicle (web `vehicle.id`); commands dispatch to it and a `0` id is a no-op.
 * @param latestSource the cache-then-network latest-command feed seam (a host adapter ↔ a test fake).
 * @param commander the command-dispatch seam (a [StoreCommandCenterCommander] adapter in production).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, `send`,
 *   command-outcome + `refresh` events. Command names are not PII.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleCommandCenterViewModel(
    private val vehicleId: Long,
    latestSource: CommandLatestSource,
    private val commander: CommandCenterCommander,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the web `queryClient` invalidation).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false
    private val mutableInFlight = MutableStateFlow<String?>(null)
    private val mutableLastResult = MutableStateFlow<CommandResultFeedback?>(null)

    /**
     * The latest-command feed as a lifecycle-aware [UiState]: loading / content / empty (no recent
     * statuses) / stale / offline / error, carrying the freshness stamp + error kind. The command grid is
     * always rendered (it is static config); this feed only decorates tiles + drives the freshness chrome.
     */
    val state: StateFlow<UiState<List<CommandLogEntry>>> =
        refreshTrigger
            .flatMapLatest { latestSource.stream() }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The command currently in flight, or `null` (web `isLoading`). While non-null every tile is disabled
     * and the matching one shows a spinner.
     */
    val inFlightCommand: StateFlow<String?> = mutableInFlight.asStateFlow()

    /** The last generic-command outcome for the inline feedback panel (web `lastResult`), or `null`. */
    val lastResult: StateFlow<CommandResultFeedback?> = mutableLastResult.asStateFlow()

    /**
     * Dispatches [command] (with optional [params]) to the vehicle — web `executeCommand`. No-op when no
     * vehicle is resolved (web `vehicle.id`) or while another command is in flight (web `isLoading`).
     * Clears the previous feedback (web `setLastResult(null)`), runs through the shared repository (only
     * the real backend [Result] advances state — ADR-013), then surfaces the outcome: a generic command
     * records [lastResult]; `wake_up` does not (web parity); both emit the one-shot toast event and refresh
     * the feed on success (web `queryClient.invalidateQueries`).
     */
    fun executeCommand(
        command: String,
        params: JsonObject? = null,
    ) {
        if (vehicleId <= 0L || mutableInFlight.value != null) return
        mutableLastResult.value = null
        mutableInFlight.value = command
        logger.info("commandCenter.send", mapOf("command" to command))
        launch {
            val outcome = commander.send(vehicleId, command, params)
            mutableInFlight.value = null
            outcome.fold(
                onSuccess = { result ->
                    if (command != WAKE_COMMAND) {
                        mutableLastResult.value = CommandResultFeedback(result.success, result.message)
                    }
                    emitEvent(UiEvent.CommandOutcome(commandKey = command, success = result.success))
                    logger.info(if (result.success) "commandCenter.ok" else "commandCenter.rejected")
                    if (result.success) refresh()
                },
                onFailure = { error ->
                    mutableLastResult.value = CommandResultFeedback(success = false, message = error.message.orEmpty())
                    emitEvent(UiEvent.CommandOutcome(commandKey = command, success = false))
                    logger.warn("commandCenter.fail", mapOf("kind" to errorKindOf(error).name))
                },
            )
        }
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("commandCenter.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id or command. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to VehicleCommandCenterRegistration.SLUG))
    }

    companion object {
        /** The wake command name (web `wake_up`) — dispatched without recording an inline result. */
        const val WAKE_COMMAND: String = "wake_up"

        private const val VIEW_OPENED = "view.opened"
        private const val SURFACE_KEY = "surface"

        /**
         * Wire the surface from the shared [VehicleCommandStore] (P1/S8) and a host-supplied
         * [latestSource]. The holder runs on `viewModelScope`; a custom scope is a test-only concern
         * handled via the constructor.
         */
        fun create(
            vehicleId: Long,
            latestSource: CommandLatestSource,
            vehicleCommandStore: VehicleCommandStore,
            logger: Logger,
        ): VehicleCommandCenterViewModel =
            VehicleCommandCenterViewModel(
                vehicleId = vehicleId,
                latestSource = latestSource,
                commander = StoreCommandCenterCommander(vehicleCommandStore),
                logger = logger,
            )
    }
}
