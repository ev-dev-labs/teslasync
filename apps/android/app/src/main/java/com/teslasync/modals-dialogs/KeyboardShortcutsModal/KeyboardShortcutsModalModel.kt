// Pure, framework-free model + registry + projection for the KeyboardShortcutsModal surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/components/feedback/KeyboardShortcutsModal.tsx) together with its data source
// (web/src/hooks/useShortcutRegistry.ts) and the app-global seed (web/src/lib/globalShortcuts.tsx). No Compose,
// no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate,
// so the composable stays a thin render layer over these pure functions.
//
// The web modal is a pure presentation surface over the keyboard-shortcut registry: it reads the union of every
// registered shortcut (useAllShortcuts), filters it by a search box + an All / Global / This page scope chip
// group, groups the survivors by their already-translated group label, sorts the groups by a fixed priority
// then alphabetically (rows by id), and renders the key combos as <kbd> chips — or a friendly "no shortcuts
// match" message when the filter clears everything.
//
// Its data source is an IN-PROCESS external store (useShortcutRegistry), NOT a cache-then-network fetch, so —
// exactly like the sibling ConfirmDialog surface — the cache lifecycle phases (loading / error / stale /
// offline) have no analogue here: there is no request, no cache, and no freshness window to model, and
// inventing them would be drift. The complete state set the web source actually defines is reproduced:
//   1. the populated state — one section per group, each row a description + its key-combo chips,
//   2. the empty state — the filter cleared every row, rendered as a friendly message (never a blank box),
//   3. the scope filter — All / Global / This page, where "This page" is the route-scoped slice for the
//      current navigation route,
//   4. the search filter — case-insensitive substring match over each row's description.
//
// InvalidPackageDeclaration is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/KeyboardShortcutsModal — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ConfirmDialog surface does.
// MatchingDeclarationName is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.keyboardshortcutsmodal

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object KeyboardShortcutsModalRegistration {
    /** Stable surface id. */
    const val ID: String = "keyboard-shortcuts-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "KeyboardShortcutsModal"
}

/**
 * Visibility scope of a registered shortcut — the native mirror of the web `ShortcutScope`
 * (`'global' | 'route' | 'page'`). [Global] entries are always visible; [Route] / [Page] entries are visible
 * only while the current navigation route starts with their [ShortcutDefinition.routeMatch] prefix.
 */
enum class ShortcutScope { Global, Route, Page }

/**
 * The scope-chip selection — the native mirror of the web `FilterMode` (`'all' | 'global' | 'page'`). [id] is
 * the stable token persisted by [KeyboardShortcutsFilterStore] (the web `sessionStorage` value).
 */
enum class FilterMode(
    val id: String,
) {
    All("all"),
    Global("global"),
    Page("page"),
    ;

    companion object {
        /** Parses a persisted [id] back to a [FilterMode], defaulting to [All] for any unknown value. */
        fun fromId(id: String?): FilterMode = entries.firstOrNull { it.id == id } ?: All
    }
}

/**
 * One registered keyboard shortcut — the native mirror of the web `ShortcutDefinition`. Pure data (no Compose
 * types) so the registry + projection are unit-tested without a UI host.
 *
 * @property id stable identity + dedupe key (web `id`); also the per-group row sort key.
 * @property keys the key-combo tokens rendered as individual chips, e.g. `["Ctrl", "K"]` (web `keys`).
 * @property description the already-translated row text the search box matches against (web `description`).
 * @property group the already-translated group label the row renders under (web `group`).
 * @property scope visibility scope (web `scope`); selects All / Global / This page membership.
 * @property routeMatch navigation-route prefix a non-global entry needs to be visible (web `routeMatch`);
 *   ignored for [ShortcutScope.Global].
 * @property priority carried through to mirror the web field so a registrar can supply it; the cheat sheet
 *   orders groups by a fixed table, not by this value.
 */
data class ShortcutDefinition(
    val id: String,
    val keys: List<String>,
    val description: String,
    val group: String,
    val scope: ShortcutScope = ShortcutScope.Global,
    val routeMatch: String? = null,
    val priority: Int = 0,
)

/**
 * A render-ready section — a group label and the rows that belong to it, already filtered + sorted by
 * [KeyboardShortcutsProjection]. The native analogue of the web `ShortcutGroup`.
 */
data class ShortcutGroup(
    val title: String,
    val shortcuts: List<ShortcutDefinition>,
)

/**
 * The in-process keyboard-shortcut registry — the native port of the web `useShortcutRegistry` external store
 * (the surface's data source / S8 holder). Any feature can [register] its own shortcuts and have them appear
 * in the cheat sheet automatically; the modal observes [shortcuts] and re-projects on every change. Owns no
 * networking and no business logic — it is purely the shared source of truth, exactly like the app-scoped
 * `SelectedVehicleStore`.
 *
 * Registration is deduped by [ShortcutDefinition.id] with last-writer-wins (web `store.entries` Map
 * semantics), so a re-registration (e.g. on a locale change re-seed) ends in the same state as a single one.
 */
class KeyboardShortcutsRegistry(
    initial: List<ShortcutDefinition> = emptyList(),
) {
    private val entries = MutableStateFlow(dedupeById(initial))

    /** The current union of every registered shortcut (web `useAllShortcuts`). */
    val shortcuts: StateFlow<List<ShortcutDefinition>> = entries.asStateFlow()

    /** Registers (or updates, by id) every entry in [defs]; a no-op for an empty list. */
    fun register(defs: List<ShortcutDefinition>) {
        if (defs.isEmpty()) return
        entries.update { current -> dedupeById(current + defs) }
    }

    /** Registers (or updates, by id) a single [def] (web `registerShortcut`). */
    fun register(def: ShortcutDefinition): Unit = register(listOf(def))

    /** Removes every entry whose id is in [ids] (web `unregisterShortcut`); a no-op for an empty set. */
    fun unregister(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val drop = ids.toHashSet()
        entries.update { current -> current.filterNot { it.id in drop } }
    }

    /** The current snapshot, for synchronous reads in tests + previews. */
    fun snapshot(): List<ShortcutDefinition> = entries.value

    companion object {
        /** The process-wide registry the surface seeds + observes by default. */
        val Default: KeyboardShortcutsRegistry by lazy { KeyboardShortcutsRegistry() }
    }
}

/** Last-writer-wins dedupe by [ShortcutDefinition.id], preserving the first-seen order of the surviving ids. */
private fun dedupeById(list: List<ShortcutDefinition>): List<ShortcutDefinition> {
    if (list.isEmpty()) return emptyList()
    val byId = LinkedHashMap<String, ShortcutDefinition>(list.size)
    for (def in list) byId[def.id] = def
    return byId.values.toList()
}

/**
 * Process-scoped holder for the chosen [FilterMode] — the native analogue of the web modal persisting the
 * scope chip in `sessionStorage` so the choice survives re-opening the sheet within the app session (the
 * modal's own composition is torn down on close, so a composition-scoped value would reset every open). Not a
 * ViewModel: like the selection store it deliberately outlives any one screen.
 */
class KeyboardShortcutsFilterStore(
    initial: FilterMode = FilterMode.All,
) {
    private val mutableMode = MutableStateFlow(initial)

    /** The currently-selected scope filter. */
    val mode: StateFlow<FilterMode> = mutableMode.asStateFlow()

    /** Persists [mode] as the active scope filter (web `writeStoredFilter`). */
    fun set(mode: FilterMode) {
        mutableMode.value = mode
    }

    companion object {
        /** The process-wide filter holder the surface reads + writes by default. */
        val Default: KeyboardShortcutsFilterStore by lazy { KeyboardShortcutsFilterStore() }
    }
}

/**
 * Pure projection from the registry snapshot + UI state to the render-ready [ShortcutGroup] list — a 1:1 port
 * of the web `filteredGroups` memo: the scope filter, the route-prefix match for non-global entries, the
 * case-insensitive description search, the group-by, and the fixed-priority-then-alphabetical group sort with
 * id-sorted rows. No Compose; unit-tested end to end.
 */
object KeyboardShortcutsProjection {
    // Web GROUP_PRIORITY — higher renders first; anything unlisted ranks 0 and sorts to the bottom alpha.
    private val GROUP_PRIORITY: Map<String, Int> =
        mapOf(
            "navigation" to 100,
            "actions" to 90,
            "global" to 90,
            "commands" to 80,
            "table" to 70,
            "bulk" to 60,
            "form" to 50,
            "chart" to 40,
            "dashboard" to 30,
            "replay" to 20,
        )

    // Web `label.toLowerCase().split(/\s|[(]/)[0]` — the first word of the (possibly parenthetical) label.
    private val FIRST_WORD = Regex("[\\s(]")

    /** The fixed render rank of a group [label] (web `groupRank`); a higher rank sorts first. */
    fun groupRank(label: String): Int {
        val words = FIRST_WORD.split(label.lowercase())
        val firstWord = words.firstOrNull().orEmpty()
        return GROUP_PRIORITY[firstWord] ?: 0
    }

    /**
     * Filters [all] by [mode] + [currentRoute] + [search], groups the survivors by their label, and returns
     * the sections in render order (web `filteredGroups`). [currentRoute] is the active navigation route the
     * "This page" scope and route-scoped entries match against (web `useLocation().pathname`).
     */
    fun groups(
        all: List<ShortcutDefinition>,
        mode: FilterMode,
        currentRoute: String,
        search: String,
    ): List<ShortcutGroup> {
        val needle = search.trim().lowercase()
        val grouped = LinkedHashMap<String, MutableList<ShortcutDefinition>>()
        for (def in all) {
            if (!isVisible(def, mode, currentRoute, needle)) continue
            grouped.getOrPut(def.group) { mutableListOf() }.add(def)
        }
        return grouped.entries
            .map { (title, rows) -> ShortcutGroup(title, rows.sortedBy { it.id }) }
            .sortedWith(compareByDescending<ShortcutGroup> { groupRank(it.title) }.thenBy { it.title })
    }

    // Web per-entry filter: scope membership, route-prefix match for non-global, then the description search.
    private fun isVisible(
        def: ShortcutDefinition,
        mode: FilterMode,
        currentRoute: String,
        needle: String,
    ): Boolean {
        // Web scope chip: All keeps everything, Global keeps only global, This page keeps only non-global.
        val scopeOk =
            when (mode) {
                FilterMode.All -> true
                FilterMode.Global -> def.scope == ShortcutScope.Global
                FilterMode.Page -> def.scope != ShortcutScope.Global
            }
        // Web route gate: a non-global entry needs a routeMatch prefix the current route starts with.
        val routeMatch = def.routeMatch
        val routeOk =
            def.scope == ShortcutScope.Global ||
                (routeMatch != null && currentRoute.startsWith(routeMatch))
        // Web search: empty needle keeps everything, otherwise the description must contain it.
        val searchOk = needle.isEmpty() || def.description.lowercase().contains(needle)
        return scopeOk && routeOk && searchOk
    }
}

/**
 * The already-translated copy the default global seed is built from — the four universal app keys' descriptions
 * plus the two group labels — resolved from the surface i18n catalog (P1/S10) at the Compose boundary and
 * handed to the pure [buildDefaultShortcuts] so the seed itself stays unit-testable.
 */
data class ShortcutSeedStrings(
    val groupActions: String,
    val groupNavigation: String,
    val openPalette: String,
    val openPaletteAlt: String,
    val openShortcuts: String,
    val closeModal: String,
)

/**
 * One navigation-shortcut seed entry: the second key of the `g` then [key] combo and its already-translated
 * "Go to <destination>" [description] (a web `GOTO_SHORTCUTS` entry rendered through `shortcuts.goto`).
 */
data class NavSeedTarget(
    val key: String,
    val description: String,
)

/**
 * Builds the app-global default shortcut seed — the native port of web `lib/globalShortcuts.tsx`: the four
 * universal keys (Ctrl+K / "/" / "?" / Esc under "Actions") plus the `g`-then-letter navigation table (under
 * "Navigation"). Every entry is [ShortcutScope.Global] (always visible), exactly as the web seed registers
 * them. Pure — the caller resolves the i18n strings + navigation labels and passes them in.
 */
fun buildDefaultShortcuts(
    strings: ShortcutSeedStrings,
    navTargets: List<NavSeedTarget>,
): List<ShortcutDefinition> {
    val universals =
        listOf(
            ShortcutDefinition("global.palette.ctrlk", listOf("Ctrl", "K"), strings.openPalette, strings.groupActions),
            ShortcutDefinition("global.palette.slash", listOf("/"), strings.openPaletteAlt, strings.groupActions),
            ShortcutDefinition("global.shortcuts.help", listOf("?"), strings.openShortcuts, strings.groupActions),
            ShortcutDefinition("global.shortcuts.escape", listOf("Esc"), strings.closeModal, strings.groupActions),
        )
    val navigation =
        navTargets.map { target ->
            ShortcutDefinition(
                id = "global.goto.${target.key}",
                keys = listOf("g", target.key),
                description = target.description,
                group = strings.groupNavigation,
            )
        }
    return universals + navigation
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [KeyboardShortcutsModalRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a shortcut description or the current route — so a diagnostics line
 * can never leak what the user is doing. Kept free of Compose so it is unit-tested with a recording [Logger];
 * the composable calls it from its first-composition effect.
 */
fun recordKeyboardShortcutsModalOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to KeyboardShortcutsModalRegistration.SLUG))
}
