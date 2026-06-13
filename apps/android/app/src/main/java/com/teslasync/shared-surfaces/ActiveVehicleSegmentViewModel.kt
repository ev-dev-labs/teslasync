// UI-thread-free state holder backing the ActiveVehicleSegment surface — the native port of the web composition
// (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx + web/src/hooks/useSelectedVehicle.ts +
// web/src/api/hooks/useVehicles.ts useVehicleState + web/src/hooks/useUnits.ts). It binds the
// [ActiveVehicleSegmentSource] seam (P1/S8), combines the persisted selection, the cache-then-network
// enrolled-fleet feed, the active vehicle's last-known state, and the live unit formatter, projects each tuple
// onto the typed [ActiveVehicleSegmentData] (via [projectActiveVehicleSegmentResource]) and then onto a
// lifecycle-aware [UiState], self-heals the selection from the live list (web "default to the first vehicle"),
// exposes select / refresh / retry, and emits the PII-safe one-shot `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [select] / [refresh] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ActiveVehicleSegment) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activevehiclesegment

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [ActiveVehicleSegment] surface — the Android port of the web
 * `ActiveVehicleSegment` component + its `useSelectedVehicle` / `useVehicleState` / `useUnits` composition.
 *
 * It binds the injected [ActiveVehicleSegmentSource] (the P1/S8 seam) to a lifecycle-aware [UiState] of the
 * projected [ActiveVehicleSegmentData]: the [ActiveVehicleSegmentSource.vehicles] feed, the
 * [ActiveVehicleSegmentSource.selectedId] flow, the active vehicle's [ActiveVehicleSegmentSource.vehicleState]
 * feed, and the [ActiveVehicleSegmentSource.units] formatter are combined so the active option + metrics
 * re-resolve whenever the fleet loads, the user picks a vehicle, the live state changes, or the unit preference
 * changes. The result covers every state the P3 checklist mandates — loading (first fetch ⇒ a chip skeleton),
 * content (the chip / switcher), empty (no enrolled vehicles ⇒ a friendly empty state), hard error (⇒
 * `QueryError`), and — through the ADR-013 freshness contract — stale and offline (the cached fleet kept shown
 * with the staleness + error flags). The view stays a thin renderer; it performs no HTTP (ADR-002).
 *
 * [init] self-heals the app-wide selection from the live list (web "default to the first vehicle"); [select]
 * writes the persisted selection (web `setVehicleId`); [refresh] / [retry] restart the feed; and [onViewOpened]
 * emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared selection + fleet + state + units seam (the real holders in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ActiveVehicleSegmentViewModel(
    private val source: ActiveVehicleSegmentSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    // The active vehicle's last-known state, switching feeds as the selection changes (web
    // `useVehicleState(vehicleId)`). Only the latest available value is folded into the metrics chip, so a
    // loading / failed state feed simply withholds the metrics rather than disturbing the fleet's UI state.
    private val activeState: Flow<VehicleState?> =
        source.selectedId.flatMapLatest { id ->
            if (id == null) flowOf(null) else source.vehicleState(id).map { it.cached?.state }
        }

    /** The active vehicle + switchable fleet + metrics as cache-then-network UI state (empty fleet ⇒ Empty phase). */
    val state: StateFlow<UiState<ActiveVehicleSegmentData>> =
        combine(
            restart.flatMapLatest { source.vehicles() },
            source.selectedId,
            activeState,
            source.units,
        ) { resource, selectedId, vehicleState, formatter ->
            projectActiveVehicleSegmentResource(resource, selectedId, vehicleState, formatter.prefs.distance)
        }.asUiState { it.isEmpty }

    init {
        // Self-heal the app-wide selection from the live list: keep a valid choice, else auto-pick the first
        // vehicle, else clear when the fleet is empty — the web `useSelectedVehicle` "default to first" effect.
        launch {
            source.vehicles().collect { resource ->
                resource.cached?.let { list -> source.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /** Selects [id] as the active vehicle for every vehicle-scoped screen (web `setVehicleId`). */
    fun select(id: Long) {
        source.select(id)
        logger.info(EVENT_SELECT, mapOf(SURFACE_KEY to ActiveVehicleSegmentRegistration.SLUG))
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordActiveVehicleSegmentOpened(logger)
    }

    /** Re-fetches the enrolled-vehicle feed (web `useVehicles` refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(SURFACE_KEY to ActiveVehicleSegmentRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_REFRESH = "activeVehicleSegment.refresh"
        private const val EVENT_SELECT = "activeVehicleSegment.select"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ActiveVehicleSegmentSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ActiveVehicleSegmentViewModel(source, logger) }
            }
    }
}
