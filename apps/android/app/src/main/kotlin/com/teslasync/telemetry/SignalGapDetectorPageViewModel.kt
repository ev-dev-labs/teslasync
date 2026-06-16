// UI-thread-free state holder backing the SignalGapDetectorPage telemetry surface — the native port of the web page's
// `useSelectedVehicle()` read (web/src/features/telemetry/pages/SignalGapDetectorPage.tsx +
// web/src/hooks/useSelectedVehicle.ts: the persisted selection composed with the fleet list and the "default to the
// first vehicle" effect). It binds the shared P1/S8 holders — the app-scoped [SelectedVehicleStore] (selection) and
// the [VehiclesStore] `vehicles()` feed — and projects the selection onto a single lifecycle-aware
// [SignalGapDetectorPageState], self-healing the selection from the live list so the page defaults to the first
// vehicle the moment the fleet loads (exactly as the web hook does). The view never performs HTTP — it only collects
// [state] and calls [recordViewOpened]; the embedded SignalCatalogPanel owns the live-signals feed itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) cannot form the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalgapdetector

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose [SignalGapDetectorPage] — the Android port of the web page's `useSelectedVehicle`
 * read. It exposes the resolved active-vehicle scope as a lifecycle-aware [StateFlow] of [SignalGapDetectorPageState]
 * and self-heals the app-wide selection from the live fleet so the page defaults to the first vehicle (web hook
 * behaviour). The page renders no data of its own — the empty branch (no selection) and the embedded catalog branch
 * both derive from [state]; the SignalCatalogPanel feature view owns its own loading / empty / error / content states.
 *
 * @param selectedVehicleStore the shared active-vehicle selection holder (P1/S8; web `useSelectedVehicleStore`).
 * @param vehiclesStore the shared enrolled-fleet holder (P1/S8; web `useVehicles`), read only to self-heal selection.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the one-shot `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SignalGapDetectorPageViewModel(
    private val selectedVehicleStore: SelectedVehicleStore,
    private val vehiclesStore: VehiclesStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The resolved active-vehicle scope as a lifecycle-aware [StateFlow]. Seeded from the store's current value so
     * the first frame is never an artificial blank, then tracks every selection change (web `useSelectedVehicle`).
     */
    val state: StateFlow<SignalGapDetectorPageState> =
        selectedVehicleStore.selectedId
            .map { SignalGapDetectorPageState(vehicleId = it) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SignalGapDetectorPageState(selectedVehicleStore.selectedId.value),
            )

    init {
        // Default-to-first: self-heal the app-wide selection from the live list — keep a valid choice, else auto-pick
        // the first vehicle, else clear when the fleet is empty (the web `useSelectedVehicle` "default to first"
        // effect). Mirrors the SelectedVehicleViewModel / VehiclePickerViewModel precedent.
        launch {
            vehiclesStore.vehicles().collect { resource ->
                resource.cached?.let { list -> selectedVehicleStore.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /**
     * Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. Carries no vehicle id
     * or signal content. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalGapDetectorPageOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel through `viewModel(…)`. */
        fun factory(
            selectedVehicleStore: SelectedVehicleStore,
            vehiclesStore: VehiclesStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SignalGapDetectorPageViewModel(selectedVehicleStore, vehiclesStore, logger) }
            }
    }
}
