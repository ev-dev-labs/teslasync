// UI-thread-free state holder backing the selectedVehicle surface — the native port of the web store
// composition (web/src/store/selectedVehicle.tsx + web/src/hooks/useSelectedVehicle.ts). It binds the
// [SelectedVehicleSource] seam (P1/S8), combines the persisted selection with the cache-then-network
// enrolled-fleet feed, projects each pair onto the typed [SelectedVehicleData] (via
// [projectSelectedVehicleResource]) and then onto a lifecycle-aware [UiState], self-heals the selection
// from the live list (web "default to the first vehicle"), exposes select / refresh / retry, and emits the
// PII-safe one-shot `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and
// calls [select] / [refresh] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/misc-surfaces/selectedVehicle) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.selectedvehicle

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
 * State holder backing the Compose [SelectedVehicle] surface — the Android port of the web store +
 * `useSelectedVehicle` composition.
 *
 * It binds the injected [SelectedVehicleSource] (the P1/S8 seam) to a lifecycle-aware [UiState] of the
 * projected [SelectedVehicleData]: the [SelectedVehicleSource.vehicles] feed and the
 * [SelectedVehicleSource.selectedId] flow are combined so the active row re-resolves whenever the fleet
 * loads OR the user picks a vehicle. The result covers every state the P3 checklist mandates — loading
 * (first fetch ⇒ skeletons), content (the active vehicle + switcher), empty (no enrolled vehicles ⇒ a
 * friendly empty state), hard error (⇒ `QueryError`), and — through the ADR-013 freshness contract — stale
 * and offline (the cached fleet kept visible with the staleness + error flags). The view stays a thin
 * renderer; it performs no HTTP (ADR-002).
 *
 * [init] self-heals the app-wide selection from the live list (web "default to the first vehicle"); [select]
 * writes the persisted selection (web `setVehicleId`); [refresh] / [retry] restart the feed; and
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared selection + fleet seam (the real holders in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SelectedVehicleViewModel(
    private val source: SelectedVehicleSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    /** The active vehicle + selectable fleet as cache-then-network UI state (empty fleet ⇒ Empty phase). */
    val state: StateFlow<UiState<SelectedVehicleData>> =
        combine(
            restart.flatMapLatest { source.vehicles() },
            source.selectedId,
        ) { resource, selectedId -> projectSelectedVehicleResource(resource, selectedId) }
            .asUiState { it.isEmpty }

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
        logger.info(EVENT_SELECT, mapOf("surface" to SelectedVehicleRegistration.SLUG))
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSelectedVehicleOpened(logger)
    }

    /** Re-fetches the enrolled-vehicle feed (web `useVehicles` refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("surface" to SelectedVehicleRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_REFRESH = "selectedVehicle.refresh"
        private const val EVENT_SELECT = "selectedVehicle.select"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: SelectedVehicleSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SelectedVehicleViewModel(source, logger) }
            }
    }
}
