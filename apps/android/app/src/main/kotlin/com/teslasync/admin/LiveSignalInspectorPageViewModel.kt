// The state holder backing the LiveSignalInspectorPage admin surface (P1/S8) — the native counterpart of the
// web page's React state + TanStack-Query hooks (web/src/features/admin/pages/LiveSignalInspectorPage.tsx). It
// owns the page's single piece of local interaction state (the selected vehicle id — web `useState<number |
// null>`) and projects the two cache-then-network reads onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState]: the vehicle list (web `useVehicles`, backing the picker) and the per-vehicle
// live snapshot (web `useVehicleLiveSignals`, gated on a selection exactly like the web hook's `enabled:
// vehicleId !== null`). All derivation logic lives in the framework-free model (LiveSignalInspectorPageModel
// .kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The web page's 1 s `refetchInterval` (with `refetchIntervalInBackground:false`) is a render-layer cadence,
// so the foreground poll is driven by the screen and lands here as [refreshLive]; this holder only exposes the
// trigger, keeping it testable off a clock.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.livesignals

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 *   [io.teslasync.shared.core.presentation.telemetry.TelemetryStore] adapter ↔ test fake); the view never
 *   performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalInspectorPageViewModel(
    private val source: LiveSignalInspectorSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val selectedVehicleId = MutableStateFlow<Long?>(null)
    private var viewOpenedRecorded = false

    /** The selected vehicle id, or `null` before a pick (web `vehicleId` state). */
    val selection: StateFlow<Long?> = selectedVehicleId.asStateFlow()

    /**
     * The vehicle list as cache-then-network UI state (loading / content / empty / stale / offline / error) —
     * backs the picker options (web `useVehicles`).
     */
    val vehicles: StateFlow<UiState<List<Vehicle>>> =
        source.vehicles().asUiState(isEmpty = { it.isEmpty() })

    /**
     * The per-vehicle live snapshot as cache-then-network UI state. Re-collected whenever the selection
     * changes (web `useVehicleLiveSignals(vehicleId)`); a `null` selection holds an idle loading value the
     * screen never renders (it shows the no-vehicle empty panel instead — web `vehicleId === null`).
     */
    val signals: StateFlow<UiState<VehicleLiveSignalsResponse>> =
        selectedVehicleId
            .flatMapLatest { id ->
                if (id == null) flowOf(IDLE) else source.vehicleLiveSignals(id)
            }
            .asUiState(isEmpty = { it.signals.isEmpty() })

    /** Pick a vehicle from the dropdown, or clear the selection (web `setVehicleId`). */
    fun selectVehicle(vehicleId: Long?) {
        selectedVehicleId.update { vehicleId }
    }

    /** Re-fetch the live snapshot for the current selection (the web `refetchInterval` poll / error retry). */
    fun refreshLive() {
        val id = selectedVehicleId.value ?: return
        source.refreshLive(id)
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refreshLive()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLiveSignalInspectorOpened(logger)
    }

    private companion object {
        /** The idle value the snapshot feed holds before any vehicle is selected. */
        val IDLE: Resource<VehicleLiveSignalsResponse> =
            Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
