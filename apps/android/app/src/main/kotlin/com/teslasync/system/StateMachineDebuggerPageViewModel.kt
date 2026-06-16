// UI-thread-free state holder backing the StateMachineDebuggerPage system surface (P1/S8) — the native port of the web
// page's four TanStack-Query reads + its local filter/selection/pagination state
// (web/src/features/system/pages/StateMachineDebuggerPage.tsx). It folds the vehicle list, the live `/vehicles/{id}/state`
// read, the `/fsm/stats` envelope, and the paged `/fsm/transitions` log into one lifecycle-aware [UiState] of a
// [DebuggerData] snapshot (the page renders every panel from it), and exposes the selected-transition signal snapshot
// (`/signals/{id}/snapshot`) as a second [UiState] feed for the inspector. It performs NO HTTP — it delegates to the
// injected [StateMachineDebuggerPageSource] (the shared Vehicles + FSM holders + the resilient client) and projects
// `Resource → UiState` via the shared `asUiState` boundary, so the screen only collects state and calls actions.
//
// The page-level phase tracks the vehicle-list feed (web `PageContainer` chrome + the `!vehicleOptions.length`
// empty branch): the FSM/state reads are secondary and fold into the snapshot with their own in-flight flags
// (`transitionsLoading`, `currentStateLoading`) so each panel draws its own loading/empty surface without gating the
// whole screen — exactly as the web page shows a skeleton inside the table while the live-state hero already renders.
// Like the sibling `SelectedVehicleViewModel`, a `restart` trigger re-collects every feed (the error-surface retry),
// and an init reconcile self-heals the app-wide selection to the first vehicle so the picker defaults like the web.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located input/holder types + Resource projection helpers.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.statemachinedebugger

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (real shared Vehicles + FSM holders ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the filter/selection events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StateMachineDebuggerPageViewModel(
    private val source: StateMachineDebuggerPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    /** The page's filter + pagination state (web `fsmType` / `serverPage` / `perPage`). */
    private val filters = MutableStateFlow(DebuggerFilters(fsmType = FsmType.ALL, page = 1, perPage = DEFAULT_PER_PAGE))

    /** The selected transition for the detail panel + snapshot inspector (web `selectedId` + its instant). */
    private val selection = MutableStateFlow<TransitionSelection?>(null)

    /** Re-collect trigger — the web queries' refetch / the error-surface retry (mirrors `SelectedVehicleViewModel`). */
    private val restart = MutableStateFlow(0)

    private var viewOpenedRecorded = false

    /** The current filter state the page binds its selectors to. */
    val filterState: StateFlow<DebuggerFilters> = filters

    /** The current transition selection the page highlights + drives the inspector from. */
    val selectionState: StateFlow<TransitionSelection?> = selection

    /**
     * The resolved page snapshot as a lifecycle-aware [UiState]: loading (first vehicle-list load) → empty (no enrolled
     * vehicle, web `!vehicleOptions.length`) → content (vehicles resolved; live state + FSM feeds folded in) → error
     * (hard list failure), plus stale/offline. The FSM/state reads are secondary — a still-loading one raises the
     * snapshot's own `*Loading` flag (web per-section skeletons) rather than blanking the page.
     */
    val uiState: StateFlow<UiState<DebuggerData>> =
        combine(source.selectedId, filters, restart) { id, currentFilters, _ -> id to currentFilters }
            .flatMapLatest { (id, currentFilters) ->
                val entity = id?.toString() ?: ""
                val stateFeed =
                    if (id != null) source.vehicleState(id) else flowOf(loadingEnvelope())
                combine(
                    source.vehicles(),
                    stateFeed,
                    source.fsmStats(entity),
                    source.fsmTransitions(entity, currentFilters.fsmType, HOURS_ALL_TIME, currentFilters.page, currentFilters.perPage),
                ) { vehiclesRes, stateRes, statsRes, transRes ->
                    buildDebuggerResource(vehiclesRes, stateRes, statsRes, transRes, id, currentFilters)
                }
            }
            .asUiState { !it.hasVehicles }

    /**
     * The selected transition's signal snapshot as a lifecycle-aware [UiState] (web `useSignalSnapshot`): loading
     * (snapshot in flight) → empty (no transition selected, or the instant carried no signals) → content. Cache-free,
     * re-derived whenever the selection or vehicle changes.
     */
    val snapshotState: StateFlow<UiState<SnapshotData>> =
        combine(source.selectedId, selection) { id, sel -> id to sel }
            .flatMapLatest { (id, sel) ->
                if (id != null && sel != null && sel.atIso.isNotBlank()) {
                    source.signalSnapshot(id, sel.atIso, "").map { resource -> resource.mapData(::parseSnapshot) }
                } else {
                    flowOf(Resource.Success(SnapshotData.empty(), fetchedAt = 0L, stale = false))
                }
            }
            .asUiState { it.signals.isEmpty() }

    init {
        // Self-heal the app-wide selection from the live list so the picker defaults to the first vehicle (web behavior).
        launch {
            source.vehicles().collect { resource ->
                resource.current()?.let { list -> source.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /** Select a vehicle (web vehicle `Select` `onChange` → `setStoreVehicleId` + `setServerPage(1)`). */
    fun selectVehicle(id: Long) {
        logger.info(EVENT_SELECT_VEHICLE)
        source.select(id)
        filters.update { it.copy(page = 1) }
        selection.value = null
    }

    /** Change the FSM-type filter (web `setFsmType` + `setServerPage(1)`). */
    fun setFsmType(fsmType: FsmType) {
        filters.update { it.copy(fsmType = fsmType, page = 1) }
    }

    /** Jump to a transition-log page (web `setServerPage`). */
    fun setPage(page: Int) {
        filters.update { it.copy(page = page) }
    }

    /** Change the page size (web `setPerPage` + `setServerPage(1)`). */
    fun setPerPage(perPage: Int) {
        filters.update { it.copy(perPage = perPage, page = 1) }
    }

    /** Toggle the selected transition for the detail panel + inspector (web `setSelectedId(id === sel ? null : id)`). */
    fun toggleTransition(
        id: Long,
        atIso: String,
    ) {
        selection.update { current -> if (current?.id == id) null else TransitionSelection(id = id, atIso = atIso) }
    }

    /** Clear the selected transition. */
    fun clearSelectedTransition() {
        selection.value = null
    }

    /** Re-collect every feed — the web queries' refetch / the error-surface retry. */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        restart.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordStateMachineDebuggerOpened(logger)
    }

    companion object {
        private const val EVENT_SELECT_VEHICLE = "fsmDebugger.selectVehicle"
        private const val EVENT_REFRESH = "fsmDebugger.refresh"

        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel over the [source]. */
        fun factory(
            source: StateMachineDebuggerPageSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { StateMachineDebuggerPageViewModel(source, logger) }
            }
    }
}

/** The page's filter + pagination inputs (web `fsmType` / `serverPage` / `perPage`). */
data class DebuggerFilters(
    val fsmType: FsmType,
    val page: Int,
    val perPage: Int,
)

/** The selected transition: its [id] (detail panel) and [atIso] instant (snapshot inspector). */
data class TransitionSelection(
    val id: Long,
    val atIso: String,
)

/** The initial "no state yet" envelope used while no vehicle is selected (keeps the live-state hero in its skeleton). */
private fun loadingEnvelope(): Resource<VehicleStateEnvelope> =
    Resource.Loading<VehicleStateEnvelope>(cached = null, fetchedAt = null, stale = false)

/**
 * Fold the four resolved feeds into one [Resource] of [DebuggerData], mirroring the vehicle-list feed's phase (the page
 * gates loading/empty on the list, exactly as the web `PageContainer` + `!vehicleOptions.length` branch do) while the
 * live state + FSM payloads fold in as data with their own in-flight flags.
 */
private fun buildDebuggerResource(
    vehiclesRes: Resource<List<Vehicle>>,
    stateRes: Resource<VehicleStateEnvelope>,
    statsRes: Resource<JsonElement>,
    transRes: Resource<JsonElement>,
    selectedId: Long?,
    filters: DebuggerFilters,
): Resource<DebuggerData> {
    val vehicles =
        (vehiclesRes.current() ?: emptyList()).map { vehicle ->
            VehicleOption(id = vehicle.id, label = vehicle.displayName.ifBlank { vehicle.vin })
        }
    val stats = parseFsmStats(statsRes.current())
    val transitionsPage = parseFsmTransitions(transRes.current())
    val data =
        DebuggerData(
            vehicles = vehicles,
            selectedId = selectedId,
            currentState = toCurrentState(stateRes.current()?.state),
            currentStateLoading = stateRes.isColdLoading(),
            transitions = transitionsPage.data,
            totalTransitions = transitionsPage.total,
            page = filters.page,
            perPage = filters.perPage,
            fsmType = filters.fsmType,
            activeSubs = stats.activeSubs,
            transitionsLoading = transRes.isColdLoading(),
        )
    return vehiclesRes.foldInto(data)
}

/** The renderable value of a [Resource] regardless of phase (cached during load/error, fresh on success). */
private fun <T> Resource<T>.current(): T? =
    when (this) {
        is Resource.Loading -> cached
        is Resource.Success -> data
        is Resource.Error -> cached
    }

/** Whether this is a first load with nothing cached yet (drives a section's own skeleton). */
private fun Resource<*>.isColdLoading(): Boolean = this is Resource.Loading && cached == null

/** Replace a [Resource]'s payload with [value] while preserving its phase + freshness (web `*SnapshotResource`). */
private fun <T, R> Resource<T>.foldInto(value: R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = if (cached == null) null else value, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(data = value, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = if (cached == null) null else value, fetchedAt = fetchedAt, stale = stale, error = error)
    }

/** Map a [Resource]'s payload through [transform], preserving phase + freshness (the snapshot JSON → [SnapshotData]). */
private fun <T, R> Resource<T>.mapData(transform: (T?) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = if (cached == null) null else transform(cached), fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(data = transform(data), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = if (cached == null) null else transform(cached), fetchedAt = fetchedAt, stale = stale, error = error)
    }
