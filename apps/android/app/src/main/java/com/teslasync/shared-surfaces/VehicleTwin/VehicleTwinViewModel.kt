// UI-thread-free state holder backing the VehicleTwin surface — the native port of the web composition
// (web/src/components/vehicles/VehicleTwin.tsx + web/src/hooks/useVehiclePaint.ts + web/src/lib/vehicleColors.ts).
// It binds the [VehicleTwinSource] seam (P1/S8), combines the persisted selection with the cache-then-network
// enrolled-fleet feed AND the per-vehicle paint override, projects each triple onto the typed [VehicleTwinData]
// (via [projectVehicleTwinResource]) and then onto a lifecycle-aware [UiState], self-heals the selection from the
// live list (web "default to the first vehicle"), exposes setPaint / refresh / retry, and emits the PII-safe
// one-shot `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [setPaint] / [refresh] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleTwin) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicletwin

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
 * State holder backing the Compose [VehicleTwin] surface — the Android port of the web `VehicleTwin` component +
 * its `useVehiclePaint` composition.
 *
 * It binds the injected [VehicleTwinSource] (the P1/S8 seam) to a lifecycle-aware [UiState] of the projected
 * [VehicleTwinData]: the fleet feed, the selection flow and the per-vehicle override flow are combined so the
 * resolved paint re-derives whenever the fleet loads, the user switches vehicle, OR the override changes. The
 * fleet feed drives the phase (loading ⇒ a silhouette skeleton, content ⇒ the painted twin, empty ⇒ a friendly
 * empty state, hard error ⇒ `QueryError`, stale / offline ⇒ the cached colour kept with the freshness flags). The
 * physical twin state is a render parameter (web prop), so it never gates the phase. The view stays a thin
 * renderer; it performs no HTTP (ADR-002).
 *
 * [init] self-heals the app-wide selection from the live list (web "default to the first vehicle"); [setPaint]
 * writes the device-local paint override for the active vehicle (web `setPaint`); [refresh] / [retry] restart the
 * fleet feed; and [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared selection + fleet + paint seam (the real holders in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleTwinViewModel(
    private val source: VehicleTwinSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    /** The resolved-paint payload as cache-then-network UI state (no resolving vehicle ⇒ Empty phase). */
    val state: StateFlow<UiState<VehicleTwinData>> =
        combine(
            restart.flatMapLatest { source.vehicles() },
            source.selectedId,
            source.selectedId.flatMapLatest { source.paintOverride(it) },
        ) { vehiclesResource, selectedId, overrideId ->
            projectVehicleTwinResource(vehiclesResource, selectedId, overrideId)
        }.asUiState { isVehicleTwinEmpty(it) }

    init {
        // Self-heal the app-wide selection from the live list: keep a valid choice, else auto-pick the first
        // vehicle, else clear when the fleet is empty — the web `useSelectedVehicle` "default to first" effect.
        launch {
            source.vehicles().collect { resource ->
                resource.cached?.let { list -> source.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /**
     * Overrides the active vehicle's paint (web `setPaint`) — a device-local choice. No-op when no vehicle is
     * selected (web disables persistence for "no vehicle yet").
     */
    fun setPaint(id: PaintPaletteId?) {
        val vehicleId = source.selectedId.value ?: return
        source.setPaint(vehicleId, id)
        logger.info(EVENT_SET_PAINT, mapOf(SURFACE_KEY to VehicleTwinRegistration.SLUG))
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVehicleTwinOpened(logger)
    }

    /** Re-fetches the enrolled-vehicle feed (web `useVehicles` refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(SURFACE_KEY to VehicleTwinRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: VehicleTwinSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehicleTwinViewModel(source, logger) }
            }
    }
}
