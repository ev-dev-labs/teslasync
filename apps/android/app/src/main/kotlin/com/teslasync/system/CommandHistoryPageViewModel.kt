// The state holder backing the CommandHistoryPage system surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/system/pages/CommandHistoryPage.tsx). It owns the
// page's local interaction state (the status facet, the search query, and the 1-based page index) as a single
// immutable [CommandHistoryInteraction] snapshot, and projects the two cache-then-network reads (`useVehicles`
// for the picker, `useCommandHistory` for the audit log) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState].
//
// Vehicle selection is the app-scoped [SelectedVehicleStore] (web `useSelectedVehicle`): the holder reconciles
// it against the live fleet so it self-heals to the first vehicle (the web "default to the first vehicle"
// behaviour) and survives navigation. The command feed re-collects whenever the selection changes or the
// refresh trigger bumps; it is gated on a selected vehicle (web `enabled: !!vehicleId`) and resolves to the
// empty list once the fleet has loaded with nothing selected, so the timeline shows its empty state rather than
// spinning forever. All derivation logic (parse / filter / stats / pagination) lives in the framework-free model
// (CommandHistoryPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located interaction/vehicle types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.commandhistory

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction snapshot — the union of the web component's `useUrlEnum('status')`,
 * `useUrlString('q')`, and `useUrlNumber('page')` params, folded into one immutable value so the composable
 * reads a single source. [filters] is the projection the model's filter predicate consumes.
 */
data class CommandHistoryInteraction(
    val status: StatusFilter = StatusFilter.All,
    val query: String = "",
    val page: Int = 1,
) {
    /** The two active filters as the model's filter shape (web URL params). */
    val filters: CommandHistoryFilters get() = CommandHistoryFilters(status, query)
}

/**
 * One vehicle-picker option — the projection of the shared [Vehicle] the page's `<Select>` binds (web
 * `vehicles.map(v => ({ value: String(v.id), label: v.display_name || … }))`). [label] prefers the display
 * name, falling back to the VIN then the id so the control is never blank — without fabricating any
 * English microcopy.
 */
data class CommandHistoryVehicle(
    val id: Long,
    val label: String,
) {
    /** The stable string value the `<Select>` option carries (web `String(v.id)`). */
    val value: String get() = id.toString()
}

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 *   [io.teslasync.shared.core.presentation.commands.CommandsStore] adapter ↔ test fake); the view never
 *   performs HTTP.
 * @param selection the app-scoped active-vehicle holder (web `useSelectedVehicle`); reconciled against the
 *   live fleet and driven by the picker.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandHistoryPageViewModel(
    private val source: CommandHistorySource,
    private val selection: SelectedVehicleStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(CommandHistoryInteraction())
    private val vehiclesRefresh = MutableStateFlow(0)
    private val commandsRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The fleet list feed, re-collected when the picker's retry bumps [vehiclesRefresh]. */
    private val vehiclesFeed: Flow<Resource<List<Vehicle>>> =
        vehiclesRefresh.flatMapLatest { source.vehicles() }

    /** The page's local interaction snapshot (web `useState`/`useUrlState` group). */
    val interaction: StateFlow<CommandHistoryInteraction> = mutableInteraction.asStateFlow()

    /** The app-scoped active-vehicle id, for the picker's selected value (web `useSelectedVehicle().vehicleId`). */
    val selectedId: StateFlow<Long?> = selection.selectedId

    /**
     * The fleet picker list as cache-then-network UI state (web `useVehicles`). The `Vehicle → CommandHistoryVehicle`
     * projection happens here so the picker binds a ready slice; an empty fleet resolves to the Empty phase.
     */
    val vehiclesState: StateFlow<UiState<List<CommandHistoryVehicle>>> =
        vehiclesFeed
            .map { resource -> resource.mapData { list -> list.toChoices() } }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The per-vehicle command history as cache-then-network UI state (web `useCommandHistory`). Re-collected
     * whenever the selection changes or the refresh trigger bumps. Gated on a selected vehicle (web
     * `enabled: !!vehicleId`): with a vehicle it streams the `/commands/history` feed; once the fleet has
     * loaded with nothing selected it resolves to the empty list (timeline empty state); while the fleet is
     * still loading it stays on the loading sentinel. The page derives stats / filtered rows / pagination from
     * this single full-history feed via the model.
     */
    val commandsState: StateFlow<UiState<List<CommandLogEntry>>> =
        combine(vehiclesFeed, selection.selectedId, commandsRefresh) { vehicles, id, _ -> vehicles to id }
            .flatMapLatest { (vehicles, id) ->
                when {
                    id != null && id > 0L ->
                        source.commandHistory(id.toString()).map { resource -> resource.mapData { parseCommands(it) } }
                    vehicles is Resource.Loading && vehicles.cached == null ->
                        flowOf(Resource.Loading<List<CommandLogEntry>>(cached = null, fetchedAt = null, stale = false))
                    else ->
                        flowOf(Resource.Success<List<CommandLogEntry>>(data = emptyList(), fetchedAt = 0L, stale = false))
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    init {
        // Self-heal the app-wide selection from the live fleet: keep a valid choice, else auto-pick the first
        // vehicle, else clear when the fleet is empty (the web "default to the first vehicle" behaviour).
        launch {
            vehiclesFeed.collect { resource ->
                resource.cached?.let { list -> selection.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    // ── Interaction setters (web `handleStatusChange` / `handleSearchChange` / `setPage` / `handleVehicleChange`) ──

    /** Select the status facet, resetting the page (web `setUrl({ status, page: null })`). */
    fun setStatus(status: StatusFilter): Unit = mutableInteraction.update { it.copy(status = status, page = 1) }

    /** Update the search query, resetting the page (web `setSearchQuery` + `setPage(1)`). */
    fun setQuery(query: String): Unit = mutableInteraction.update { it.copy(query = query, page = 1) }

    /** Go to [page] (1-based, clamped at one) — the web `setPage`. */
    fun setPage(page: Int): Unit = mutableInteraction.update { it.copy(page = page.coerceAtLeast(1)) }

    /** Pick a vehicle from the header `<Select>` and reset the page (web `handleVehicleChange`). */
    fun selectVehicle(id: Long) {
        if (id <= 0L) return
        selection.select(id)
        mutableInteraction.update { it.copy(page = 1) }
    }

    // ── Refresh / retry (web query `refetch` + the error-state retry) ───────────────────────────────────────────

    /** Re-collect the command-history feed — the web `refetch` / error-retry affordance. */
    fun refresh() {
        logger.info("commandHistory.refresh")
        commandsRefresh.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Re-collect the fleet list — the picker's hard-error retry affordance. */
    fun refreshVehicles() {
        logger.info("commandHistory.refreshVehicles")
        vehiclesRefresh.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCommandHistoryPageOpened(logger)
    }
}

/** Projects the shared fleet list into picker options (web `vehicles.map(...)`), preserving server order. */
private fun List<Vehicle>.toChoices(): List<CommandHistoryVehicle> =
    map { vehicle ->
        val label = vehicle.displayName.ifBlank { vehicle.vin.ifBlank { vehicle.id.toString() } }
        CommandHistoryVehicle(id = vehicle.id, label = label)
    }
