// UI-thread-free state holder backing the VehiclePicker surface — the native port of the web composition
// (web/src/components/layout/VehiclePicker.tsx + web/src/hooks/useSelectedVehicle.ts +
// web/src/store/selectedVehicle.tsx + web/src/api/hooks/usePinned.ts). It binds the [VehiclePickerSource] seam
// (P1/S8), combines the persisted selection with the cache-then-network enrolled-fleet feed AND the
// best-effort `vehicle` pin feed, projects each triple onto the typed [VehiclePickerData] (via
// [projectVehiclePickerResource]) and then onto a lifecycle-aware [UiState], self-heals the selection from the
// live list (web "default to the first vehicle"), exposes select / refresh / retry, and emits the PII-safe
// one-shot `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [select] / [refresh] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehiclePicker) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepicker

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [VehiclePicker] surface — the Android port of the web `VehiclePicker`
 * component + its `useSelectedVehicle` / `usePinned` composition.
 *
 * It binds the injected [VehiclePickerSource] (the P1/S8 seam) to a lifecycle-aware [UiState] of the projected
 * [VehiclePickerData]: the [VehiclePickerSource.vehicles] feed, the [VehiclePickerSource.selectedId] flow and
 * the [VehiclePickerSource.pinned] feed are combined so the rows re-resolve whenever the fleet loads, the user
 * picks a vehicle, OR the pin set changes. The fleet feed drives the phase (loading ⇒ a select-shaped
 * skeleton, content ⇒ the dropdown / single indicator, empty ⇒ a friendly empty state, hard error ⇒
 * `QueryError`, stale / offline ⇒ the cached fleet kept selectable with the freshness flags). The pins are a
 * best-effort ordering input only (web `usePinned` default `[]`): the latest available pin list is folded into
 * the projection and NEVER gates the phase, so a slow / failed pin load still shows a fully usable picker. The
 * view stays a thin renderer; it performs no HTTP (ADR-002).
 *
 * [init] self-heals the app-wide selection from the live list (web "default to the first vehicle"); [select]
 * writes the persisted selection (web `setVehicleId`); [refresh] / [retry] restart the fleet feed; and
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared selection + fleet + pin seam (the real holders in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclePickerViewModel(
    private val source: VehiclePickerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    /** The pin-ordered, active-tagged fleet as cache-then-network UI state (empty fleet ⇒ Empty phase). */
    val state: StateFlow<UiState<VehiclePickerData>> =
        combine(
            restart.flatMapLatest { source.vehicles() },
            source.selectedId,
            source.pinned(),
        ) { vehiclesResource, selectedId, pinsResource ->
            projectVehiclePickerResource(vehiclesResource, pinsResource.cached ?: emptyList(), selectedId)
        }.asUiState { it.isEmpty }

    init {
        // Self-heal the app-wide selection from the live list: keep a valid choice, else auto-pick the first
        // vehicle, else clear when the fleet is empty — the web `useSelectedVehicle` "default to first" effect.
        // Driven off the ORIGINAL fleet order (the pin sort is a display-only concern).
        launch {
            source.vehicles().collect { resource ->
                resource.cached?.let { list -> source.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /** Selects [id] as the active vehicle for every vehicle-scoped screen (web `setVehicleId`). */
    fun select(id: Long) {
        source.select(id)
        logger.info(EVENT_SELECT, mapOf(SURFACE_KEY to VehiclePickerRegistration.SLUG))
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVehiclePickerOpened(logger)
    }

    /** Re-fetches the enrolled-vehicle feed (web `useVehicles` refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(SURFACE_KEY to VehiclePickerRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_REFRESH = "vehiclePicker.refresh"
        private const val EVENT_SELECT = "vehiclePicker.select"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: VehiclePickerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehiclePickerViewModel(source, logger) }
            }
    }
}
