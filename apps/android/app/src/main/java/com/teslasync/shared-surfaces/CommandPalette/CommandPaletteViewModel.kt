// The UI-thread-free state holder backing the CommandPalette shared surface — the native port of the web
// component's composition (web/src/components/ui/CommandPalette.tsx). It binds the [CommandPaletteSource] seam
// (P1/S8) into the lifecycle-aware state the view collects: the enrolled fleet + active selection as a
// cache-then-network [UiState] (loading / content / empty / error / stale / offline), the live entity-search feed
// as its own [UiState], the deployment auth mode, the frecency scores + recent-page history, and the palette's own
// transient UI state (the query, the search ⇄ vehicle-select mode, and the pending command awaiting a target).
//
// The view performs NO business logic — it collects these flows and calls [onQueryChange] / [selectCommand] /
// [chooseVehicleForCommand] / [switchVehicle] / [recordNavigation] / [runRegistry] / [goBack] / [reset] /
// [refresh] / [onViewOpened]. Navigation itself is the view's concern (the web `useNavigate` has no native data
// equivalent), so a chosen route flows back to the view through [CommandSelectOutcome] / [RegistryRouting] and the
// view invokes its `onNavigate` callback — keeping this holder free of any Compose/navigation dependency (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located outcome types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.commandpalette

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/** The two palette modes — searching the catalog, or picking a target vehicle for a pending command (web `mode`). */
enum class CommandPaletteMode { Search, VehicleSelect }

/** The outcome of choosing a vehicle command — drives whether the view closes, opens the picker, or no-ops. */
sealed interface CommandSelectOutcome {
    /** A single-vehicle fleet ran the command immediately — the view should close (web `executeCommand`). */
    data object Ran : CommandSelectOutcome

    /** A multi-vehicle fleet entered the "pick a target" submode — the view stays open (web `setMode`). */
    data object NeedsVehicle : CommandSelectOutcome

    /** No vehicle is enrolled — the command is ignored (web `vehicleList.length === 0`). */
    data object NoVehicle : CommandSelectOutcome
}

/** The routing of a chosen registry command — navigate to a route, or fire an app effect (handled in the holder). */
sealed interface RegistryRouting {
    /** The view should navigate to [webPath] and close (web `cmd.invoke()` → `navigate(path)`). */
    data class Navigate(
        val webPath: String,
    ) : RegistryRouting

    /** The effect was applied in the holder (refresh / reset) or dispatched to the host; the view just closes. */
    data object Effected : RegistryRouting
}

/**
 * State holder backing the Compose [CommandPalette] surface — the Android port of the web `CommandPalette`.
 *
 * @param source the unified P1/S8 seam (real holders in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives only PII-safe events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param now wall-clock seam for frecency scoring; injectable for deterministic tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandPaletteViewModel(
    private val source: CommandPaletteSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val now: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    private val queryState = MutableStateFlow("")
    private val modeState = MutableStateFlow(CommandPaletteMode.Search)
    private val pendingCommandState = MutableStateFlow<String?>(null)

    /** The raw search input, including any active scope prefix (web `query`). */
    val query: StateFlow<String> = queryState.asStateFlow()

    /** The current mode — searching, or picking a target vehicle for a pending command (web `mode`). */
    val mode: StateFlow<CommandPaletteMode> = modeState.asStateFlow()

    /** The command awaiting a target vehicle while in [CommandPaletteMode.VehicleSelect] (web `pendingCommand`). */
    val pendingCommand: StateFlow<String?> = pendingCommandState.asStateFlow()

    /** The enrolled fleet + active selection as cache-then-network UI state (empty fleet ⇒ Empty phase). */
    val fleet: StateFlow<UiState<CommandPaletteFleet>> =
        combine(restart.flatMapLatest { source.vehicles() }, source.selectedId) { resource, selectedId ->
            projectFleetResource(resource, selectedId)
        }.asUiState { it.isEmpty }

    /** The live entity-search hits as cache-then-network UI state (too-short query ⇒ empty, non-loading). */
    val search: StateFlow<UiState<List<PaletteSearchHit>>> =
        source.searchResults.map { projectSearchResource(it) }.asUiState { it.isEmpty() }

    /** The deployment auth-mode boolean (web `useIsForwardAuth`) — gates auth-only nav rows. */
    val isForwardAuth: StateFlow<Boolean> = source.isForwardAuth

    /** The frecency scores behind the empty-query "Most Used" ranking (web `getAllCommandScores`). */
    val scores: StateFlow<Map<String, Double>> =
        source.recent
            .map { frecencyScores(it.frecency, now()) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_MILLIS), emptyMap())

    /** The strict-recency recent-page history behind the empty-query "Recent" section (web `getRecentPages`). */
    val recentPages: StateFlow<List<RecentPageEntry>> =
        source.recent
            .map { it.recentPages }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_MILLIS), emptyList())

    init {
        // Self-heal the app-wide selection from the live list (web `useSelectedVehicle` "default to first").
        launch {
            source.vehicles().collect { resource ->
                resource.cached?.let { list -> source.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCommandPaletteViewOpened(logger)
    }

    /** Updates the query and re-plans the live search with the scoped term (web `setQuery` + debounce + gate). */
    fun onQueryChange(raw: String) {
        queryState.value = raw
        val parsed = parsePalettePrefix(raw)
        val gated = modeState.value == CommandPaletteMode.Search && parsed.scope == null
        source.setSearchQuery(if (gated) parsed.term.trim() else "")
    }

    /** Re-fetches the fleet (web `useVehicles` refetch); also re-plans search via the current query. */
    fun refresh() {
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Chooses a vehicle command (web `selectCommand`): runs immediately on a single-vehicle fleet, opens the
     * target picker on a multi-vehicle fleet, or no-ops when no vehicle is enrolled.
     */
    fun selectCommand(command: String): CommandSelectOutcome {
        val data = fleet.value.data
        return when {
            data == null || data.isEmpty -> CommandSelectOutcome.NoVehicle
            data.soleVehicleId != null -> dispatchAndRun(command, data.soleVehicleId ?: return CommandSelectOutcome.NoVehicle)
            else -> {
                enterVehicleSelect(command)
                CommandSelectOutcome.NeedsVehicle
            }
        }
    }

    /** Runs the pending command against the chosen [id] (web vehicle-select row tap). */
    fun chooseVehicleForCommand(id: Long) {
        val command = pendingCommandState.value ?: return
        dispatch(command, id)
    }

    /** Switches the active vehicle without leaving the page (web `switchActiveVehicle` → `setVehicleId`). */
    fun switchVehicle(id: Long) {
        source.select(id)
        source.recordUse("switch-vehicle-$id")
    }

    /** Records a navigation for frecency + the recent-page list before the view routes (web `go`). */
    fun recordNavigation(
        itemId: String,
        path: String,
        title: String,
        icon: PaletteIconKind,
    ) {
        source.recordUse(frecencyLookupId(itemId))
        source.recordRecentPage(path, title, icon)
    }

    /** Records a registry command and routes it (web `runRegistryCommand`) — navigate, or apply an app effect. */
    fun runRegistry(config: RegistryCommandConfig): RegistryRouting {
        source.recordUse(config.id)
        return when (val action = config.action) {
            is RegistryAction.Navigate -> RegistryRouting.Navigate(action.webPath)
            is RegistryAction.Effect -> {
                applyEffect(action.kind)
                RegistryRouting.Effected
            }
        }
    }

    /** Leaves the vehicle-select submode back to search (web `goBack`). */
    fun goBack() {
        modeState.value = CommandPaletteMode.Search
        pendingCommandState.value = null
        clearQuery()
    }

    /** Resets all transient state when the palette closes (web `close`). */
    fun reset() {
        modeState.value = CommandPaletteMode.Search
        pendingCommandState.value = null
        clearQuery()
    }

    private fun dispatchAndRun(
        command: String,
        vehicleId: Long,
    ): CommandSelectOutcome {
        dispatch(command, vehicleId)
        return CommandSelectOutcome.Ran
    }

    private fun enterVehicleSelect(command: String) {
        pendingCommandState.value = command
        modeState.value = CommandPaletteMode.VehicleSelect
        clearQuery()
    }

    private fun dispatch(
        command: String,
        vehicleId: Long,
    ) {
        source.recordUse("cmd-$command")
        launch {
            source.sendCommand(vehicleId, command).fold(
                onSuccess = { emitEvent(UiEvent.CommandOutcome(command, it.success)) },
                onFailure = { emitEvent(UiEvent.CommandOutcome(command, success = false)) },
            )
        }
    }

    private fun applyEffect(kind: String) {
        when (kind) {
            RegistryEffect.REFRESH -> refresh()
            RegistryEffect.FRECENCY_RESET -> source.resetFrecency()
            else -> source.runEffect(kind)
        }
    }

    private fun clearQuery() {
        queryState.value = ""
        source.setSearchQuery("")
    }

    companion object {
        private const val STOP_MILLIS = 5_000L

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: CommandPaletteSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { CommandPaletteViewModel(source, logger) }
            }
    }
}
