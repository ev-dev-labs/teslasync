// The state holder backing the GuardModePage surface (P1/S8) — the native counterpart of the web page's React state
// + its five queries and three mutations (web/src/features/vehicle-systems/pages/GuardModePage.tsx). It projects each
// shared-core cache-then-network read onto the lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState],
// owns the page's local interaction snapshot ([GuardInteraction]: the settings overrides + the panic dialog + the
// per-mutation pending flags), and drives the web invalidation rules through targeted refresh triggers (set-config →
// config + events; panic / acknowledge → events). It re-collects whenever the active vehicle changes (web
// `useSelectedVehicle`) and polls the vehicle-state feed on the web `refetchInterval` cadence (5 s while armed, 30 s
// otherwise). With no vehicle in scope every read parks on a terminal empty (the web disabled-query
// `enabled: vehicleId > 0` case), so the screen renders its disarmed defaults rather than an endless spinner. All
// derivation logic lives in the framework-free model (GuardModePageModel.kt); this holder is the thin orchestration
// layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located interaction snapshot.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import io.teslasync.shared.core.presentation.guard.SetGuardConfigInput
import io.teslasync.shared.core.presentation.guard.guardVehicleEnabled
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction snapshot — the native mirror of the web page's `useState` cells. The three settings
 * overrides default blank/null so the effective value falls through to the persisted config (web
 * `sensitivity || guardConfig?.sensitivity || 'medium'` family); the dialog + pending flags drive the panic
 * confirmation and the mutation spinners (web `setConfig.isPending` / `panic.isPending` / `ackEvent.isPending`).
 *
 * @property sensitivityOverride the user's sensitivity pick, or blank to use the persisted config (web `sensitivity`).
 * @property homeGeofenceOverride the user's home-fence pick (string id / blank), or blank to use the config.
 * @property autoPanicOverride the user's auto-panic toggle, or null until touched (web `autoPanic`).
 * @property panicDialogOpen whether the panic confirmation dialog is open (web `panicDialogOpen`).
 * @property setConfigPending whether a set-config mutation is in flight (web `setConfig.isPending`).
 * @property panicPending whether a panic mutation is in flight (web `panic.isPending`).
 * @property ackPending whether an acknowledge mutation is in flight (web `ackEvent.isPending`).
 */
data class GuardInteraction(
    val sensitivityOverride: String = "",
    val homeGeofenceOverride: String = "",
    val autoPanicOverride: Boolean? = null,
    val panicDialogOpen: Boolean = false,
    val setConfigPending: Boolean = false,
    val panicPending: Boolean = false,
    val ackPending: Boolean = false,
)

/**
 * @param source the P1/S8 data seam (real shared Guard/Vehicles/Location adapters + [io.teslasync.android.data.SelectedVehicleStore]
 *   ↔ test fakes); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the mutation outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GuardModePageViewModel(
    private val source: GuardModePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val configRefresh = MutableStateFlow(0)
    private val eventsRefresh = MutableStateFlow(0)
    private val geofencesRefresh = MutableStateFlow(0)
    private val vehiclesRefresh = MutableStateFlow(0)
    private val vehicleStateTick = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(GuardInteraction())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (settings overrides + panic dialog + mutation-pending flags). */
    val interaction: StateFlow<GuardInteraction> = mutableInteraction.asStateFlow()

    /** The global active-vehicle selection (web `useSelectedVehicle`). */
    val selectedVehicleId: StateFlow<Long?> = source.selectedVehicleId()

    /** The enrolled-vehicle list (web `useVehicles`) — backs the header picker + the live-map vehicle name. */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> =
        vehiclesRefresh
            .flatMapLatest { source.vehicles() }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The per-vehicle guard config (web `useGuardConfig`). Gated on a selected vehicle (web `enabled: vehicleId > 0`):
     * with none it parks on a terminal empty (null config) so the page shows its disarmed defaults. Re-collected when
     * the active vehicle changes or the config refresh trigger bumps.
     */
    val configState: StateFlow<UiState<GuardConfig?>> =
        combine(selectedVehicleId, configRefresh) { id, _ -> id }
            .flatMapLatest { id ->
                if (!guardVehicleEnabled(id?.toString())) {
                    flowOf<Resource<GuardConfig?>>(Resource.Success(null, fetchedAt = 0L, stale = false))
                } else {
                    source.guardConfig(id!!.toString())
                }
            }.asUiState(isEmpty = { it == null })

    /**
     * The per-vehicle guard events (web `useGuardEvents`), unwrapped to a plain list. Gated on a selected vehicle;
     * with none it parks on an empty success the timeline renders as its "no events" empty state.
     */
    val eventsState: StateFlow<UiState<List<GuardEvent>>> =
        combine(selectedVehicleId, eventsRefresh) { id, _ -> id }
            .flatMapLatest { id ->
                if (!guardVehicleEnabled(id?.toString())) {
                    flowOf<Resource<List<GuardEvent>>>(Resource.Success(emptyList(), fetchedAt = 0L, stale = false))
                } else {
                    source.guardEvents(id!!.toString())
                }
            }.asUiState(isEmpty = { it.isEmpty() })

    /**
     * The live vehicle state (web `useVehicleState`). Gated on a selected vehicle and polled on the web
     * `refetchInterval` cadence via [vehicleStateTick]. The empty predicate folds the web `hasLocation` guard so the
     * live map shows its "no location" empty state when no usable fix is available.
     */
    val vehicleStateState: StateFlow<UiState<VehicleStateEnvelope?>> =
        combine(selectedVehicleId, vehicleStateTick) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null || id <= 0L) {
                    flowOf<Resource<VehicleStateEnvelope?>>(Resource.Success(null, fetchedAt = 0L, stale = false))
                } else {
                    source.vehicleState(id)
                }
            }.asUiState(isEmpty = { it?.state == null || !guardHasLocation(it.state) })

    /** The geofence list (web `useGeofences`) — backs the home-geofence select + the live-map fence circle. */
    val geofencesState: StateFlow<UiState<List<Geofence>>> =
        geofencesRefresh
            .flatMapLatest { source.geofences() }
            .asUiState(isEmpty = { it.isEmpty() })

    init {
        // Poll the live vehicle-state feed on the web refetchInterval cadence (5 s armed / 30 s idle). Only the
        // lifecycle-aware feed actually re-fetches — the tick bump is a no-op while the screen is not observing.
        launch {
            while (true) {
                val armed = guardArmed(configState.value.data)
                delay(if (armed) ARMED_POLL_MS else IDLE_POLL_MS)
                vehicleStateTick.update { it + 1 }
            }
        }
    }

    // ── Interaction actions ─────────────────────────────────────────────────────────────────────────────────────

    /** Selects the active vehicle (header `VehicleSelect`, web `actions={<VehicleSelect />}`). */
    fun selectVehicle(vehicleId: Long) = source.selectVehicle(vehicleId)

    /** Picks the trigger sensitivity (web `setSensitivity`). */
    fun setSensitivity(value: String) = mutableInteraction.update { it.copy(sensitivityOverride = value) }

    /** Picks the home geofence by string id, "" for none (web `setHomeGeofenceId`). */
    fun setHomeGeofence(value: String) = mutableInteraction.update { it.copy(homeGeofenceOverride = value) }

    /** Toggles auto-panic on trigger (web `setAutoPanic`). */
    fun setAutoPanic(value: Boolean) = mutableInteraction.update { it.copy(autoPanicOverride = value) }

    /** Opens the panic confirmation dialog (web `setPanicDialogOpen(true)`). */
    fun openPanicDialog() = mutableInteraction.update { it.copy(panicDialogOpen = true) }

    /** Closes the panic confirmation dialog (web `setPanicDialogOpen(false)` / `onCancel`). */
    fun closePanicDialog() = mutableInteraction.update { it.copy(panicDialogOpen = false) }

    /** Arms / disarms guard (web `handleToggleGuard`): sets the config with `enabled` flipped. */
    fun toggleGuard() {
        val id = activeVehicleId() ?: return
        submitConfig(id, enabled = !guardArmed(configState.value.data))
    }

    /** Persists the current settings without changing armed state (web `handleSaveSettings`). */
    fun saveSettings() {
        val id = activeVehicleId() ?: return
        submitConfig(id, enabled = guardArmed(configState.value.data))
    }

    /** Fires a panic alert for the active vehicle (web `handlePanic`). */
    fun panic() {
        val id = activeVehicleId() ?: return
        mutableInteraction.update { it.copy(panicDialogOpen = false, panicPending = true) }
        launch {
            val result = source.triggerPanic(id.toString())
            mutableInteraction.update { it.copy(panicPending = false) }
            if (result.isSuccess) eventsRefresh.update { it + 1 }
            logger.info("guard.panic", mapOf("ok" to result.isSuccess.toString()))
        }
    }

    /** Acknowledges a guard event (web `handleAcknowledge`). */
    fun acknowledge(eventId: Long) {
        val id = activeVehicleId() ?: return
        mutableInteraction.update { it.copy(ackPending = true) }
        launch {
            val result = source.acknowledgeEvent(id.toString(), eventId)
            mutableInteraction.update { it.copy(ackPending = false) }
            if (result.isSuccess) eventsRefresh.update { it + 1 }
            logger.info("guard.acknowledge", mapOf("ok" to result.isSuccess.toString()))
        }
    }

    private fun submitConfig(
        vehicleId: Long,
        enabled: Boolean,
    ) {
        val snapshot = mutableInteraction.value
        val config = configState.value.data
        val input =
            SetGuardConfigInput(
                vehicleId = vehicleId.toString(),
                enabled = enabled,
                homeGeofenceId = effectiveHomeGeofenceId(snapshot.homeGeofenceOverride, config).toLongOrNull(),
                sensitivity = effectiveSensitivity(snapshot.sensitivityOverride, config),
                autoPanic = effectiveAutoPanic(snapshot.autoPanicOverride, config),
            )
        mutableInteraction.update { it.copy(setConfigPending = true) }
        launch {
            val result = source.setGuardConfig(input)
            mutableInteraction.update { it.copy(setConfigPending = false) }
            if (result.isSuccess) {
                // web useSetGuardConfig invalidates BOTH guardKeys.config and guardKeys.events.
                configRefresh.update { it + 1 }
                eventsRefresh.update { it + 1 }
            }
            logger.info("guard.setConfig", mapOf("ok" to result.isSuccess.toString()))
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────

    /** Re-collect every feed — the web query `refetch` / the error-retry + pull-to-refresh. */
    fun refresh() {
        logger.info("guard.refresh")
        configRefresh.update { it + 1 }
        eventsRefresh.update { it + 1 }
        geofencesRefresh.update { it + 1 }
        vehiclesRefresh.update { it + 1 }
        vehicleStateTick.update { it + 1 }
    }

    /** Retry affordance for any feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGuardModePageOpened(logger)
    }

    /** The active vehicle id when one is selected and positive (web `activeVehicleId > 0` guard), else null. */
    private fun activeVehicleId(): Long? = selectedVehicleId.value?.takeIf { it > 0L }

    private companion object {
        const val ARMED_POLL_MS = 5_000L
        const val IDLE_POLL_MS = 30_000L
    }
}
