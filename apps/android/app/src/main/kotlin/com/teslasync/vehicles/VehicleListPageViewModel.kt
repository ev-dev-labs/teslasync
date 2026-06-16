// The state holder backing the VehicleListPage fleet surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/vehicles/pages/VehicleListPage.tsx). It projects the
// enrolled-vehicle list onto the shared lifecycle-aware [UiState] surface (the loading / empty / error / content
// matrix), batch-resolves each vehicle's last-known state into one map (the web `Promise.all` of
// `fetchVehicleState`), tracks the pin list (web `usePinned`) + the live display preferences (web `useUnits`),
// and owns the sync + delete mutation lifecycles (web `syncMut` / `deleteMut` + the `deleteTarget` dialog state).
// All derivation logic lives in the framework-free model (VehicleListPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.vehicles.vehiclelist

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/** The lifecycle of the sync-from-Tesla mutation, driving the success/error banners (web `syncMut` state). */
enum class SyncStatus { Idle, Loading, Success, Error }

/** The i18n key the sync-success toast resolves (web `toast.success(t('vehicles.syncToast'))`). */
const val VEHICLES_SYNC_TOAST_KEY: String = "vehicles.syncToast"

/** The i18n key the sync-failure toast resolves (web `toast.error(t('vehicles.syncFailed'))`). */
const val VEHICLES_SYNC_FAILED_KEY: String = "vehicles.syncFailed"

/** The i18n key the delete-success toast resolves (web `toast.success(t('vehicles.deleteSuccess'))`). */
const val VEHICLES_DELETE_SUCCESS_KEY: String = "vehicles.deleteSuccess"

/** The i18n key the delete-failure toast resolves (web `toast.error(t('vehicles.deleteFailed'))`). */
const val VEHICLES_DELETE_FAILED_KEY: String = "vehicles.deleteFailed"

/**
 * @param source the P1/S8 data seam (the shared [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 *   [io.teslasync.shared.core.presentation.pinned.PinnedStore] + the shared
 *   [io.teslasync.shared.core.presentation.settings.SettingsStore] ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `sync` + `delete` +
 *   `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleListPageViewModel(
    private val source: VehicleListPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val mutableSync = MutableStateFlow(SyncStatus.Idle)
    private val mutableDeleteTarget = MutableStateFlow<Vehicle?>(null)
    private val mutableDeleting = MutableStateFlow(false)

    /** The sync-from-Tesla lifecycle (web `syncMut`): drives the success/error banners + the button spinner. */
    val syncStatus: StateFlow<SyncStatus> = mutableSync.asStateFlow()

    /** The vehicle pending removal, or null when the confirm dialog is closed (web `deleteTarget`). */
    val deleteTarget: StateFlow<Vehicle?> = mutableDeleteTarget.asStateFlow()

    /** Whether a delete is in flight (web `deleteMut.isPending`): drives the confirm dialog spinner. */
    val deleting: StateFlow<Boolean> = mutableDeleting.asStateFlow()

    /**
     * The enrolled-vehicle list as cache-then-network UI state (web `useQuery(['vehicles'])`). Drives the
     * loading / empty / error / content surfaces; an empty list parks on
     * [io.teslasync.android.data.UiPhase.Empty], which the page renders as its no-vehicles empty state. Re-collected
     * whenever the refresh trigger bumps (the page error-retry + pull-to-refresh affordance).
     */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The resolved last-known state per vehicle id (web `fleetStates` after the `Promise.all` of
     * `fetchVehicleState`). Re-collected whenever the enrolled id set changes; a per-vehicle read that has not
     * resolved (or failed) contributes a null entry, exactly as the web `catch { state: null }`. The model folds
     * this map with the vehicle list into the summary metrics, battery bars, and per-card state.
     */
    val fleetStates: StateFlow<Map<Long, VehicleState?>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .map { resource -> (resource.cached ?: emptyList()).map { it.id } }
            .distinctUntilChanged()
            .flatMapLatest { ids -> combineVehicleStates(ids) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyMap())

    /** The unified vehicle pins (web `usePinned('vehicle')`); a cold/failed read resolves to an empty list. */
    val pins: StateFlow<List<PinnedItem>> =
        source
            .usePinned()
            .map { it.cached ?: emptyList() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /**
     * The live display preferences derived from the settings document (web `useUnits`). Shared while observed;
     * falls back to the metric/en-US/2dp defaults before settings load so the first frame is never blank.
     */
    val displayPrefs: StateFlow<VehicleListDisplayPrefs> =
        source
            .settings()
            .map { resource -> VehicleListDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), VehicleListDisplayPrefs.DEFAULT)

    /** Triggers the sync-from-Tesla mutation (web `syncMut.mutate()`); flips the banners + emits the toast. */
    fun sync() {
        if (mutableSync.value == SyncStatus.Loading) return
        mutableSync.value = SyncStatus.Loading
        logger.info("vehicles.sync")
        launch {
            val result = source.syncVehicles()
            if (result.isSuccess) {
                mutableSync.value = SyncStatus.Success
                emitEvent(UiEvent.Message(VEHICLES_SYNC_TOAST_KEY, severity = UiEvent.Severity.Success))
                refreshTrigger.update { it + 1 }
            } else {
                mutableSync.value = SyncStatus.Error
                emitEvent(UiEvent.Message(VEHICLES_SYNC_FAILED_KEY, severity = UiEvent.Severity.Error))
            }
        }
    }

    /** Opens the remove-vehicle confirm dialog for [vehicle] (web `setDeleteTarget(vehicle)`). */
    fun requestDelete(vehicle: Vehicle) {
        mutableDeleteTarget.value = vehicle
    }

    /** Dismisses the confirm dialog without removing (web `onCancel` / `setDeleteTarget(null)`). */
    fun cancelDelete() {
        mutableDeleteTarget.value = null
    }

    /** Confirms removal of the pending vehicle (web `deleteMut.mutate(deleteTarget.id)`) + emits the toast. */
    fun confirmDelete() {
        val target = mutableDeleteTarget.value ?: return
        mutableDeleting.value = true
        logger.info("vehicles.delete")
        launch {
            val result = source.deleteVehicle(target.id)
            mutableDeleting.value = false
            mutableDeleteTarget.value = null
            if (result.isSuccess) {
                emitEvent(UiEvent.Message(VEHICLES_DELETE_SUCCESS_KEY, severity = UiEvent.Severity.Success))
                refreshTrigger.update { it + 1 }
            } else {
                emitEvent(UiEvent.Message(VEHICLES_DELETE_FAILED_KEY, severity = UiEvent.Severity.Error))
            }
        }
    }

    /** Pins or unpins [vehicleId] (web `useTogglePin('vehicle')`); the pin feed self-refreshes on success. */
    fun togglePin(
        vehicleId: Long,
        pin: Boolean,
    ) {
        logger.info("vehicles.togglePin")
        launch { source.togglePin(vehicleId.toString(), pin) }
    }

    /** Re-collect every bound feed — the page error-retry + pull-to-refresh affordance. */
    fun retry() {
        logger.info("vehicles.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to VehicleListPageRegistration.SLUG))
    }

    /**
     * Combines the per-vehicle state feeds into one id -> state map (web `Promise.all` of `fetchVehicleState`). An
     * empty id set short-circuits to an empty map (combine of no flows never emits otherwise); each feed projects
     * to its last-known [VehicleState] or null (the web `state ?? null`).
     */
    private fun combineVehicleStates(ids: List<Long>): Flow<Map<Long, VehicleState?>> =
        if (ids.isEmpty()) {
            flowOf(emptyMap())
        } else {
            combine(ids.map { id -> source.fetchVehicleState(id).map { id to it.cached?.state } }) { it.toMap() }
        }
}
