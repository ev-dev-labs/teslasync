// The data seam the CommandPalette surface binds to, plus its production binding over the shared P1/S8 holders and
// a self-contained recent/frecency store. Named after the surface bundle (CommandPalette*) rather than the single
// interface it declares. The view (composable) performs NO HTTP — it only collects state from the ViewModel,
// which drives this seam (ADR-002), satisfying the "no direct HTTP from the view" contract.
//
// The web component reads eight hooks (useVehicles, useSelectedVehicle, useVehicleCommand, useGlobalSearch,
// useIsForwardAuth, useNavigate, useCommandRegistry, plus the localStorage-backed commandFrecency / recentPages).
// This seam unifies them: the enrolled fleet + active selection bind to the shared VehiclesStore +
// SelectedVehicleStore (already exposed app-wide via the DataContainer, so the palette folds into the same
// upstream every vehicle-scoped surface follows); the live entity search binds to the shared SearchStore; command
// dispatch binds to the shared VehicleCommandStore; the deployment auth mode binds to the shared AuthModeStore;
// and the frecency + recent-page history is a self-contained in-memory store (the native analogue of the web
// localStorage primitives — same client-side responsibility, scoped to the process).
//
// The SearchStore / VehicleCommandStore / AuthModeStore are shared-core holders that the app DataContainer does
// not yet surface (they are not part of any already-shipped page), so — exactly like the sibling
// CommandQuickActionsWidget, whose `commander` is host-supplied — they are injected here. The no-argument
// production binding resolves the always-available fleet + selection from the LocalDataContainer and defaults the
// injected trio to safe, honest fallbacks (an empty, non-loading search feed — identical to the SearchStore's own
// too-short-query result; a `false` auth mode — the store's own pre-resolution default; and a command dispatch
// that returns a logged failure). A host that owns those holders passes them in for full live wiring.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the port
// interface + its production adapters co-located in one file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.commandpalette

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchInput
import io.teslasync.shared.core.presentation.search.SearchOptions
import io.teslasync.shared.core.presentation.search.SearchResponse
import io.teslasync.shared.core.presentation.search.SearchStore
import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import io.teslasync.shared.core.presentation.vehiclecommand.SendVehicleCommandInput
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** One recently-visited route — the native analogue of the web `RecentEntry` (localStorage `recentPages`). */
data class RecentPageEntry(
    val path: String,
    val title: String,
    val icon: PaletteIconKind,
    val visitedAtMillis: Long,
)

/**
 * The client-side history the palette surfaces in its empty-query state — the [frecency] table behind "Most Used"
 * (web `commandFrecency`) and the strict-recency [recentPages] list behind "Recent" (web `recentPages`). Both are
 * client-side concerns the web keeps in localStorage; the native surface keeps them in-process.
 */
data class PaletteRecentState(
    val frecency: Map<String, FrecencyEntry> = emptyMap(),
    val recentPages: List<RecentPageEntry> = emptyList(),
)

/**
 * The single seam the [io.teslasync.android.sharedsurfaces.commandpalette.CommandPaletteViewModel] depends on so it
 * binds to abstractions (real holders ↔ test fakes), never concrete clients — the native counterpart of the web
 * palette's eight hooks (P1/S8 state-holder boundary). No HTTP touches the view.
 */
interface CommandPaletteSource {
    /** Cache-then-network enrolled fleet (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The persisted active-vehicle id, or `null` when none (web `useSelectedVehicle().vehicleId`). */
    val selectedId: StateFlow<Long?>

    /** Persist [id] as the active vehicle (web `setVehicleId`). */
    fun select(id: Long)

    /** Self-heal the selection against the live list (web "default to the first vehicle"). */
    fun reconcile(availableIds: List<Long>)

    /** Set the live entity-search query (web `useGlobalSearch` arg). The store enforces the min-length gate. */
    fun setSearchQuery(query: String)

    /** The shared cache-then-network search feed (web `useGlobalSearch` result). */
    val searchResults: StateFlow<Resource<SearchResponse>>

    /** Send a Tesla command to [vehicleId] (web `useVehicleCommand`). Returns the repository's [Result] verbatim. */
    suspend fun sendCommand(
        vehicleId: Long,
        command: String,
    ): Result<CommandResult>

    /** The deployment auth-mode boolean (web `useIsForwardAuth`) — hides auth-gated nav items in open mode. */
    val isForwardAuth: StateFlow<Boolean>

    /** The client-side frecency + recent-page history (web `commandFrecency` + `recentPages`). */
    val recent: StateFlow<PaletteRecentState>

    /** Record one usage of [key] for frecency ranking (web `recordCommandUse`). */
    fun recordUse(key: String)

    /** Record a navigation to [path] for the strict-recency "Recent" section (web `recentPages` recorder). */
    fun recordRecentPage(
        path: String,
        title: String,
        icon: PaletteIconKind,
    )

    /** Clear the frecency table (web `frecencyReset` action). */
    fun resetFrecency()

    /** Fire a named app effect (theme toggle, tour, …) the host owns (web `cmd.invoke()` for non-nav registry rows). */
    fun runEffect(kind: String)
}

/**
 * The production recent/frecency store — a small, self-contained in-process state holder backing the web
 * localStorage primitives. [recordUse] folds a usage into the frecency table (via [recordFrecencyUse]); [recordPage]
 * unshifts a de-duplicated, capped recent-page entry; [reset] clears the frecency table. Instances are app-scoped
 * (one per process) so every palette placement shares one history. [now] is injectable for deterministic tests.
 */
class PaletteRecentStore(
    private val now: () -> Long = { System.currentTimeMillis() },
    private val maxRecentPages: Int = MAX_RECENT_PAGES,
) {
    private val mutable = MutableStateFlow(PaletteRecentState())

    /** The live history the palette observes. */
    val state: StateFlow<PaletteRecentState> = mutable.asStateFlow()

    /** Records one usage of [key], incrementing its count and stamping the last-used time. */
    fun recordUse(key: String) {
        mutable.update { it.copy(frecency = recordFrecencyUse(it.frecency, key, now())) }
    }

    /** Unshifts a [path] visit (de-duplicating any prior entry for the same path) and caps the list length. */
    fun recordPage(
        path: String,
        title: String,
        icon: PaletteIconKind,
    ) {
        val entry = RecentPageEntry(path, title, icon, now())
        mutable.update { prev ->
            val deduped = prev.recentPages.filterNot { it.path == path }
            prev.copy(recentPages = (listOf(entry) + deduped).take(maxRecentPages))
        }
    }

    /** Clears the frecency table, leaving recent pages intact (web `frecencyReset`). */
    fun reset() {
        mutable.update { it.copy(frecency = emptyMap()) }
    }

    private companion object {
        const val MAX_RECENT_PAGES = 10
    }
}

/**
 * The optional shared-core holders the surface binds when a host supplies them — the live entity search (web
 * `useGlobalSearch`), the command dispatch (web `useVehicleCommand`), and the deployment auth mode (web
 * `useIsForwardAuth`). The app [io.teslasync.android.data.DataContainer] does not yet surface these (they are not
 * part of any already-shipped page), so they are injected — exactly like the sibling CommandQuickActionsWidget's
 * host-supplied commander. Each defaults to `null`, leaving the surface on its safe fallback.
 */
data class CommandPaletteStores(
    val search: SearchStore? = null,
    val command: VehicleCommandStore? = null,
    val authMode: AuthModeStore? = null,
)

/**
 * Binds the surface to the shared P1/S8 holders. The fleet + selection are always resolved from the app-scoped
 * [VehiclesStore] + [SelectedVehicleStore]; the injected [stores] carry the host-supplied search / command / auth
 * holders (when absent the surface degrades to safe, honest fallbacks). [recent] is the self-contained client-side
 * history. No HTTP touches the view.
 */
class StoreCommandPaletteSource(
    private val vehiclesStore: VehiclesStore,
    private val selection: SelectedVehicleStore,
    private val recentStore: PaletteRecentStore,
    private val logger: Logger,
    private val stores: CommandPaletteStores = CommandPaletteStores(),
) : CommandPaletteSource {
    private val offlineForwardAuth = MutableStateFlow(false)
    private val emptySearch = MutableStateFlow<Resource<SearchResponse>>(EMPTY_SEARCH)

    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

    override val selectedId: StateFlow<Long?> = selection.selectedId

    override fun select(id: Long) {
        selection.select(id)
    }

    override fun reconcile(availableIds: List<Long>) {
        selection.reconcile(availableIds)
    }

    override fun setSearchQuery(query: String) {
        stores.search?.setInput(SearchInput(query, SearchOptions(limit = CommandPaletteRegistration.SEARCH_LIMIT)))
    }

    override val searchResults: StateFlow<Resource<SearchResponse>> = stores.search?.results ?: emptySearch

    override suspend fun sendCommand(
        vehicleId: Long,
        command: String,
    ): Result<CommandResult> {
        val store = stores.command ?: return Result.failure(IllegalStateException(NO_COMMAND_STORE))
        return store.sendCommand(SendVehicleCommandInput(vehicleId = vehicleId, command = command))
    }

    override val isForwardAuth: StateFlow<Boolean> = stores.authMode?.isForwardAuth ?: offlineForwardAuth

    override val recent: StateFlow<PaletteRecentState> = recentStore.state

    override fun recordUse(key: String) {
        recentStore.recordUse(key)
    }

    override fun recordRecentPage(
        path: String,
        title: String,
        icon: PaletteIconKind,
    ) {
        recentStore.recordPage(path, title, icon)
    }

    override fun resetFrecency() {
        recentStore.reset()
    }

    override fun runEffect(kind: String) {
        // refresh + frecency-reset are owned by the surface (ViewModel/recent store); the rest are host-wired app
        // effects (theme, tour, shortcuts). A logged diagnostic records the request so an unwired effect is honest
        // and discoverable rather than a silent no-op (Honesty Covenant #9). Carries only the non-PII effect kind.
        if (kind == RegistryEffect.FRECENCY_RESET) {
            recentStore.reset()
            return
        }
        logger.info(EVENT_EFFECT, mapOf(SURFACE_KEY to CommandPaletteRegistration.SLUG, EFFECT_KEY to kind))
    }

    private companion object {
        const val NO_COMMAND_STORE = "command store not wired"
        const val EVENT_EFFECT = "commandPalette.effect"
        const val EFFECT_KEY = "effect"
        val EMPTY_SEARCH: Resource<SearchResponse> = Resource.Success(SearchResponse(), fetchedAt = 0L, stale = false)
    }
}

/** Maps a [SearchHitType] to its catalog section-key suffix so the render boundary resolves `search.section.*`. */
fun searchHitSectionSuffix(type: SearchHitType): String =
    when (type) {
        SearchHitType.Vehicle -> "vehicle"
        SearchHitType.Drive -> "drive"
        SearchHitType.Charging -> "charging"
        SearchHitType.Alert -> "alert"
        SearchHitType.Notification -> "notification"
        SearchHitType.Geofence -> "geofence"
        SearchHitType.Automation -> "automation"
        SearchHitType.Location -> "location"
        SearchHitType.Trip -> "trip"
    }
