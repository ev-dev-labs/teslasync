// Pure, framework-free model + derivations for the CommandPalette shared surface — the native analogue of every
// value the web component computes before it returns JSX (web/src/components/ui/CommandPalette.tsx). No Compose,
// no Android UI, no networking: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web surface is a global command palette (a Cmd/Ctrl-K overlay): a search box over a categorized,
// keyboard-navigable list of every place you can go (the nav routes), every vehicle command you can run, every
// registry action (theme, refresh, …), every vehicle you can switch to, and live backend entity search hits. It
// supports power-user scope prefixes (`>` commands, `/` pages, `@` vehicles, `:` settings), a frecency-ranked
// "Most Used" + a strict-recency "Recent" section in the empty-query state, and a two-step "pick a vehicle" mode
// when a command needs a target and the fleet has more than one vehicle.
//
// This model reproduces the data those behaviours need — the scope-prefix parse (web `parsePrefix`), the fuzzy
// scorer (web `scoreCommand`), the frecency math (web `commandFrecency`), the scope filter + rank + group fold
// (web `filtered` / grouped render), the command/registry catalogs, the search-hit → section mapping, and the
// recent-age bucketing — so the surface honestly renders the prompt's loading / content / empty / error / stale /
// offline matrix without ever hiding a region.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9,
// documented not silent): the palette has two genuine cache-then-network feeds — the enrolled fleet (web
// `useVehicles`) and the live entity search (web `useGlobalSearch`). Both flow through the shared
// io.teslasync.android.data.UiState envelope so loading (first fetch), content, empty (no fleet / no hits), error
// (hard failure + retry), stale and offline (cached value kept usable with a freshness chip) all render. The
// search-min-length gate (web `SEARCH_MIN_QUERY_LENGTH`) settles a short query to an empty, non-loading result
// without a request — reproduced by the shared SearchStore the surface binds to.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as the
// sibling VehicleSelect / ActiveFilterChips / Layout surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.sharedsurfaces.commandpalette

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.search.SearchHit
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchResponse

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract.
 */
object CommandPaletteRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CommandPalette"

    /** Stable `viewModel` key the composable binds the surface with. */
    const val ID: String = "command-palette"

    /** Max frecency-ranked rows shown in the empty-query "Most Used" section (web `MOST_USED_MAX_DISPLAY`). */
    const val MOST_USED_MAX: Int = 5

    /** Max strict-recency rows shown in the empty-query "Recent" section (web `RECENT_PAGES_DISPLAY_LIMIT`). */
    const val RECENT_MAX: Int = 5

    /** Per-type live entity-search hit cap (web `useGlobalSearch(..., { limit: 5 })`). */
    const val SEARCH_LIMIT: Int = 5
}

/**
 * The discriminator of a palette row — the native port of the web `PaletteItem.type` union. It both selects the
 * row's action and maps the row to a scope-prefix bucket (see [PaletteScope]).
 */
enum class PaletteItemType {
    /** Navigate to an app route (web `'navigate'`) — nav items + recent pages. */
    Navigate,

    /** Run a Tesla vehicle command, choosing a target vehicle first when the fleet has > 1 (web `'command'`). */
    VehicleCommand,

    /** Switch the active vehicle without leaving the page (web `'vehicle-switch'`). */
    VehicleSwitch,

    /** Invoke a static registry action — theme, refresh, a feature page (web `'registry'`). */
    Registry,

    /** Open a live backend entity-search hit (web `'search-hit'`). */
    SearchHit,
}

/**
 * The framework-free icon identity of a palette row. The render boundary maps each kind to a concrete glyph
 * (TeslaGlyphs / NavGlyphs) so this model never imports a Compose/Android type and stays unit-testable.
 */
enum class PaletteIconKind {
    Search,
    Command,
    Lightning,
    SwitchVehicle,
    Page,
    Vehicle,
    Drive,
    Charging,
    Alert,
    Notification,
    Geofence,
    Automation,
    Location,
    Trip,
    Action,
    Settings,
    Theme,
    Refresh,
    Help,
    Lock,
    Unlock,
    Climate,
    ClimateOff,
    Frunk,
    Trunk,
    Horn,
    Flash,
}

/**
 * A power-user scope prefix — the native port of the web `palettePrefix` table. Typing the [prefix] character at
 * the very start of the query locks the palette to the [types] of items, exactly as VS Code / Raycast / Linear do.
 */
enum class PaletteScope(
    val prefix: Char,
    val types: Set<PaletteItemType>,
) {
    /** `>` → vehicle commands. */
    Commands('>', setOf(PaletteItemType.VehicleCommand)),

    /** `/` → app pages. */
    Pages('/', setOf(PaletteItemType.Navigate)),

    /** `@` → vehicle switching. */
    Vehicles('@', setOf(PaletteItemType.VehicleSwitch)),

    /** `:` → registry / settings actions. */
    Settings(':', setOf(PaletteItemType.Registry)),
}

/** The parsed `{ scope, term }` of a raw palette input — the native port of the web `ParsedPrefix`. */
data class ParsedPrefix(
    val scope: PaletteScope?,
    val term: String,
)

/**
 * Parses a raw palette input into [ParsedPrefix] exactly as the web `parsePrefix`: a recognized prefix MUST be the
 * very first character; one optional space after it is consumed; an unknown leading character (or empty input) is
 * treated as plain search text with a `null` scope.
 */
fun parsePalettePrefix(input: String): ParsedPrefix {
    val scope =
        input.firstOrNull()?.let { head -> PaletteScope.entries.firstOrNull { it.prefix == head } }
            ?: return ParsedPrefix(scope = null, term = input)
    val rest = input.drop(1)
    return ParsedPrefix(scope = scope, term = if (rest.startsWith(' ')) rest.drop(1) else rest)
}

/**
 * Whether an item of [type] belongs to the active [scope] — the native port of the web `itemMatchesScope`. A
 * `null` scope (no prefix) admits every item.
 */
fun itemMatchesScope(
    type: PaletteItemType,
    scope: PaletteScope?,
): Boolean = scope == null || type in scope.types

/**
 * One render-ready palette row. The label / sublabel / section are already localized by the render boundary
 * (P1/S10), so this stays framework-free and the scorer matches against the same strings the user reads — the
 * native analogue of the web `PaletteItem`.
 *
 * @property id stable identity (also the frecency key; a `most-used-` display variant is de-prefixed for lookup).
 * @property type the row discriminator + scope bucket.
 * @property label the already-localized primary label the scorer ranks against.
 * @property section the already-localized section header the row is grouped under (web `item.section`).
 * @property sublabel the optional already-localized secondary line (a light substring-match fallback).
 * @property keywords lowercase-insensitive search synonyms the scorer also ranks against.
 * @property icon the framework-free glyph identity.
 * @property shortcut an optional display-only shortcut hint (e.g. "g d").
 * @property targetPath the route path (Navigate rows) or entity url (SearchHit rows) the row opens, when applicable.
 */
data class PaletteItem(
    val id: String,
    val type: PaletteItemType,
    val label: String,
    val section: String,
    val sublabel: String? = null,
    val keywords: List<String> = emptyList(),
    val icon: PaletteIconKind = PaletteIconKind.Command,
    val shortcut: String? = null,
    val targetPath: String? = null,
)

/** A grouped run of rows sharing one [section] header, in first-appearance order (web grouped render). */
data class PaletteGroup(
    val section: String,
    val items: List<PaletteItem>,
)

/** Match-score tiers — the native port of the web `scoreCommand` ladder (label tiers, keyword tiers, fuzzy). */
private object Score {
    const val LABEL_EXACT = 1000
    const val LABEL_PREFIX = 600
    const val LABEL_WORD = 400
    const val LABEL_CONTAINS = 200
    const val KEYWORD_EXACT = 100
    const val KEYWORD_PREFIX = 60
    const val KEYWORD_CONTAINS = 40
    const val SUBSEQUENCE = 25
    const val SUBLABEL = 10
    const val SECTION = 5

    /** Server-ranked entity hits skip local scoring and pin above static rows (web pseudo-score 9999). */
    const val SEARCH_HIT = 9999
}

/**
 * Scores how well [term] matches [label] + [keywords] — the native port of the web `scoreCommand`. Higher is
 * better; `0` means no match. Tiers run label-exact → label-prefix → label-word-start → label-contains →
 * keyword-exact → keyword-prefix → keyword-contains → label-subsequence, so "btr" still matches "Battery Health"
 * via subsequence while a true label prefix always outranks a keyword prefix.
 */
fun scoreCommand(
    term: String,
    label: String,
    keywords: List<String>,
): Int {
    val q = term.trim().lowercase()
    if (q.isEmpty()) return 0
    val l = label.lowercase()
    val kw = keywords.map { it.lowercase() }
    return when {
        l == q -> Score.LABEL_EXACT
        l.startsWith(q) -> Score.LABEL_PREFIX
        anyWordStartsWith(l, q) -> Score.LABEL_WORD
        l.contains(q) -> Score.LABEL_CONTAINS
        kw.any { it == q } -> Score.KEYWORD_EXACT
        kw.any { it.startsWith(q) } -> Score.KEYWORD_PREFIX
        kw.any { it.contains(q) } -> Score.KEYWORD_CONTAINS
        isSubsequence(q, l) -> Score.SUBSEQUENCE
        else -> 0
    }
}

/** True when any whitespace/punctuation-delimited word in [text] starts with [prefix] (web word-boundary tier). */
private fun anyWordStartsWith(
    text: String,
    prefix: String,
): Boolean = text.split(WORD_SPLIT).any { it.startsWith(prefix) }

/** Classic subsequence test: are all of [needle]'s chars present in [haystack] in order (web fuzzy fallback). */
private fun isSubsequence(
    needle: String,
    haystack: String,
): Boolean {
    var i = 0
    for (c in haystack) {
        if (i < needle.length && needle[i] == c) i++
    }
    return i == needle.length
}

/**
 * Scores a whole [item] against [term] — the native port of the web per-item scorer: search hits pin high, then
 * the label/keyword score, then a lighter sublabel/section substring fallback (web `best === 0` branch).
 */
fun scoreItem(
    item: PaletteItem,
    term: String,
): Int = if (item.type == PaletteItemType.SearchHit) Score.SEARCH_HIT else scoreStaticItem(item, term)

private fun scoreStaticItem(
    item: PaletteItem,
    term: String,
): Int {
    val base = scoreCommand(term, item.label, item.keywords)
    if (base > 0) return base
    val q = term.trim().lowercase()
    return when {
        item.sublabel?.lowercase()?.contains(q) == true -> Score.SUBLABEL
        item.section.lowercase().contains(q) -> Score.SECTION
        else -> 0
    }
}

/** A scored row carried through the rank fold so the score + frecency tiebreak survive the sort. */
private data class ScoredItem(
    val item: PaletteItem,
    val score: Int,
    val frecency: Double,
)

/**
 * Filters + ranks [items] for a parsed query — the native port of the web `filtered` memo. Narrows by scope (a
 * `null` scope is a no-op), returns every scoped item verbatim for an empty term, otherwise scores each row, drops
 * non-matches, and sorts by score then frecency (the tiebreak: among equal scores, the more frecent ranks higher).
 */
fun rankItems(
    items: List<PaletteItem>,
    parsed: ParsedPrefix,
    frecency: Map<String, Double>,
): List<PaletteItem> {
    val scoped = if (parsed.scope == null) items else items.filter { itemMatchesScope(it.type, parsed.scope) }
    val term = parsed.term.trim()
    if (term.isEmpty()) return scoped
    return scoped
        .map { ScoredItem(it, scoreItem(it, term), frecency[frecencyLookupId(it.id)] ?: 0.0) }
        .filter { it.score > 0 }
        .sortedWith(compareByDescending<ScoredItem> { it.score }.thenByDescending { it.frecency })
        .map { it.item }
}

/**
 * Builds the empty-query "Most Used" rows — the native port of the web `mostUsedItems`. Ranks the static
 * [candidates] by [frecency], keeps the top [limit], and re-keys + re-sections each so a row can also appear in
 * its own native section below without a duplicate-key clash (web `most-used-${id}`).
 */
fun mostUsedItems(
    candidates: List<PaletteItem>,
    frecency: Map<String, Double>,
    sectionLabel: String,
    limit: Int = CommandPaletteRegistration.MOST_USED_MAX,
): List<PaletteItem> =
    candidates
        .map { it to (frecency[frecencyLookupId(it.id)] ?: 0.0) }
        .filter { it.second > 0.0 }
        .sortedByDescending { it.second }
        .take(limit)
        .map { (item, _) -> item.copy(id = "$MOST_USED_PREFIX${item.id}", section = sectionLabel) }

/** De-prefixes a `most-used-` display id back to its canonical id for frecency lookup (web `lookupId`). */
fun frecencyLookupId(id: String): String = id.removePrefix(MOST_USED_PREFIX)

/**
 * Groups [items] into [PaletteGroup]s by their already-localized [PaletteItem.section], preserving first-appearance
 * order — the native port of the web grouped render. A stable group order keeps the keyboard cursor predictable.
 */
fun groupItems(items: List<PaletteItem>): List<PaletteGroup> {
    val buckets = LinkedHashMap<String, MutableList<PaletteItem>>()
    items.forEach { buckets.getOrPut(it.section) { mutableListOf() }.add(it) }
    return buckets.map { (section, rows) -> PaletteGroup(section, rows) }
}

/** A single recorded usage of a palette id — count + last-used wall-clock — the native `commandFrecency` entry. */
data class FrecencyEntry(
    val count: Int,
    val lastUsedMillis: Long,
)

/**
 * The frecency score for one [entry] at [nowMillis] — the native port of the web `commandFrecency` weighting:
 * usage count times a recency multiplier that decays through hour / day / week / month buckets, so a command used
 * three times today outranks a one-off click from last week.
 */
fun frecencyScore(
    entry: FrecencyEntry,
    nowMillis: Long,
): Double {
    val ageMs = (nowMillis - entry.lastUsedMillis).coerceAtLeast(0)
    val weight =
        when {
            ageMs < HOUR_MS -> WEIGHT_HOUR
            ageMs < DAY_MS -> WEIGHT_DAY
            ageMs < WEEK_MS -> WEIGHT_WEEK
            ageMs < MONTH_MS -> WEIGHT_MONTH
            else -> WEIGHT_OLD
        }
    return entry.count * weight
}

/** Snapshots a frecency table into id → score at [nowMillis] (web `getAllCommandScores`). */
fun frecencyScores(
    entries: Map<String, FrecencyEntry>,
    nowMillis: Long,
): Map<String, Double> = entries.mapValues { frecencyScore(it.value, nowMillis) }

/**
 * Records one usage of [key] at [nowMillis] into [entries], returning the updated table — the pure core of the web
 * `recordCommandUse`. Increments the count and stamps the last-used time.
 */
fun recordFrecencyUse(
    entries: Map<String, FrecencyEntry>,
    key: String,
    nowMillis: Long,
): Map<String, FrecencyEntry> {
    val prior = entries[key]
    return entries + (key to FrecencyEntry((prior?.count ?: 0) + 1, nowMillis))
}

/** The bucketed age of a recently-visited page — the render boundary localizes each variant (web `formatRecentVisitedAgo`). */
sealed interface RecentAge {
    /** Less than a minute ago (web `palette.recent.justNow`). */
    data object JustNow : RecentAge

    /** [value] minutes ago (web `palette.recent.minutesAgo`). */
    data class Minutes(
        val value: Int,
    ) : RecentAge

    /** [value] hours ago (web `palette.recent.hoursAgo`). */
    data class Hours(
        val value: Int,
    ) : RecentAge

    /** [value] days ago (web `palette.recent.daysAgo`). */
    data class Days(
        val value: Int,
    ) : RecentAge
}

/** Buckets the gap between [visitedAtMillis] and [nowMillis] into a [RecentAge] (web `formatRecentVisitedAgo`). */
fun recentAge(
    visitedAtMillis: Long,
    nowMillis: Long,
): RecentAge {
    val diffMin = ((nowMillis - visitedAtMillis).coerceAtLeast(0) / MINUTE_MS).toInt()
    return when {
        diffMin < 1 -> RecentAge.JustNow
        diffMin < MINUTES_PER_HOUR -> RecentAge.Minutes(diffMin)
        diffMin < MINUTES_PER_DAY -> RecentAge.Hours(diffMin / MINUTES_PER_HOUR)
        else -> RecentAge.Days(diffMin / MINUTES_PER_DAY)
    }
}

/** One enrolled vehicle, projected framework-free for the switch + select-target rows. */
data class PaletteVehicle(
    val id: Long,
    val label: String,
    val model: String?,
)

/** The vehicle's palette label — `display_name || vin` (web), framework-free so it is asserted off-device. */
fun paletteVehicleLabel(vehicle: Vehicle): String = vehicle.displayName.ifBlank { vehicle.vin }

/** Projects the enrolled [vehicles] onto [PaletteVehicle] rows. */
fun projectPaletteVehicles(vehicles: List<Vehicle>): List<PaletteVehicle> =
    vehicles.map { PaletteVehicle(it.id, paletteVehicleLabel(it), it.model) }

/**
 * The projected fleet payload the surface renders — the enrolled [vehicles] and the active selection. Drives the
 * single-vehicle command shortcut (run immediately), the multi-vehicle "pick a target" submode, and the
 * switch-vehicle section (which hides the active vehicle so the list never offers a no-op).
 */
data class CommandPaletteFleet(
    val vehicles: List<PaletteVehicle>,
    val activeVehicleId: Long?,
) {
    /** True when there is no enrolled vehicle (drives the "No vehicles available" empty surface). */
    val isEmpty: Boolean get() = vehicles.isEmpty()

    /** True when a vehicle command must first ask which vehicle to target (web `vehicleList.length > 1`). */
    val needsVehicleChoice: Boolean get() = vehicles.size > 1

    /** The lone vehicle's id when the fleet has exactly one (web single-vehicle immediate-run shortcut). */
    val soleVehicleId: Long? get() = vehicles.singleOrNull()?.id

    /** The switch-targets: every vehicle except the active one (web `filter(v => v.id !== activeVehicleId)`). */
    val switchTargets: List<PaletteVehicle> get() = if (vehicles.size < 2) emptyList() else vehicles.filter { it.id != activeVehicleId }
}

/**
 * Resolves the effective active-vehicle id from the persisted [stored] choice against the live [availableIds] — the
 * native mirror of the web `useSelectedVehicle` default: keep a valid still-enrolled choice, else the first
 * vehicle, else `null` for an empty fleet. Native has no URL tier, so the web URL > store > first precedence
 * collapses to store > first.
 */
fun effectivePaletteSelection(
    stored: Long?,
    availableIds: List<Long>,
): Long? =
    when {
        availableIds.isEmpty() -> null
        stored != null && stored > 0 && stored in availableIds -> stored
        else -> availableIds.first()
    }

/** Projects the enrolled [vehicles] + persisted [storedSelectedId] onto the [CommandPaletteFleet] the surface renders. */
fun projectFleet(
    vehicles: List<Vehicle>,
    storedSelectedId: Long?,
): CommandPaletteFleet =
    CommandPaletteFleet(
        vehicles = projectPaletteVehicles(vehicles),
        activeVehicleId = effectivePaletteSelection(storedSelectedId, vehicles.map(Vehicle::id)),
    )

/**
 * Maps a raw `GET /vehicles` [Resource] onto a typed [Resource] of the projected [CommandPaletteFleet], preserving
 * the cache-then-network envelope (cached value, freshness stamp, staleness, error) so the downstream
 * [io.teslasync.android.data.UiState] still drives loading / content / empty / stale / offline / error correctly.
 */
fun projectFleetResource(
    resource: Resource<List<Vehicle>>,
    storedSelectedId: Long?,
): Resource<CommandPaletteFleet> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(resource.cached?.let { projectFleet(it, storedSelectedId) }, resource.fetchedAt, resource.stale)
        is Resource.Success ->
            Resource.Success(projectFleet(resource.data, storedSelectedId), resource.fetchedAt, resource.stale)
        is Resource.Error ->
            Resource.Error(resource.cached?.let { projectFleet(it, storedSelectedId) }, resource.fetchedAt, resource.stale, resource.error)
    }

/**
 * Maps a raw `GET /search` [Resource] onto a typed [Resource] of projected [PaletteSearchHit]s, preserving the
 * cache-then-network envelope so the search results region drives its own loading / content / empty / error matrix.
 */
fun projectSearchResource(resource: Resource<SearchResponse>): Resource<List<PaletteSearchHit>> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(resource.cached?.let { projectSearchHits(it.hits) }, resource.fetchedAt, resource.stale)
        is Resource.Success ->
            Resource.Success(projectSearchHits(resource.data.hits), resource.fetchedAt, resource.stale)
        is Resource.Error ->
            Resource.Error(resource.cached?.let { projectSearchHits(it.hits) }, resource.fetchedAt, resource.stale, resource.error)
    }

/** A Tesla hardware command config — the catalog-backed native subset of the web `PALETTE_COMMAND_CONFIGS`. */
data class VehicleCommandConfig(
    val id: String,
    val command: String,
    val icon: PaletteIconKind,
    val keywords: List<String>,
)

/**
 * The hardware vehicle commands the palette offers — the catalog-backed native subset (the same set the sibling
 * CommandQuickActionsWidget renders). The web `PALETTE_COMMAND_CONFIGS` labels are fallback-only (no P1/S10 entry),
 * so this native surface uses the localized command labels that DO ship in the catalog (the `glance.action.*` /
 * `digitalTwin.*` / `activity.action.*` keys) — a documented, i18n-clean parity choice (Honesty Covenant #9).
 */
val VEHICLE_COMMAND_CONFIGS: List<VehicleCommandConfig> =
    listOf(
        VehicleCommandConfig("cmd-lock", "lock", PaletteIconKind.Lock, listOf("lock", "security", "doors", "secure")),
        VehicleCommandConfig("cmd-unlock", "unlock", PaletteIconKind.Unlock, listOf("unlock", "open", "doors")),
        VehicleCommandConfig("cmd-climate_on", "climate_on", PaletteIconKind.Climate, listOf("climate", "ac", "heat", "cool", "hvac")),
        VehicleCommandConfig("cmd-climate_off", "climate_off", PaletteIconKind.ClimateOff, listOf("climate", "off", "ac", "stop")),
        VehicleCommandConfig("cmd-frunk_open", "frunk_open", PaletteIconKind.Frunk, listOf("frunk", "front", "trunk", "hood")),
        VehicleCommandConfig("cmd-trunk_open", "trunk_open", PaletteIconKind.Trunk, listOf("trunk", "rear", "boot")),
        VehicleCommandConfig("cmd-honk_horn", "honk_horn", PaletteIconKind.Horn, listOf("horn", "honk", "beep", "sound")),
        VehicleCommandConfig("cmd-flash_lights", "flash_lights", PaletteIconKind.Flash, listOf("flash", "lights", "blink", "find")),
    )

/** The effect a registry row performs when chosen — either route to a page, or fire a named app effect. */
sealed interface RegistryAction {
    /** Navigate to an app route (web `cmd.invoke()` that does `navigate(path)`). */
    data class Navigate(
        val webPath: String,
    ) : RegistryAction

    /** Fire a named app effect (theme toggle, data refresh, …) routed through the surface seam. */
    data class Effect(
        val kind: String,
    ) : RegistryAction
}

/** A static registry command — the native port of one `useCommandRegistry` entry (web `COMMANDS`). */
data class RegistryCommandConfig(
    val id: String,
    val section: RegistrySection,
    val icon: PaletteIconKind,
    val keywords: List<String>,
    val action: RegistryAction,
    val shortcut: String? = null,
)

/** The three registry section buckets the web palette groups actions under. */
enum class RegistrySection { Preferences, Actions, Pages }

/** Named registry effects routed through the surface seam (the host wires the ones it owns). */
object RegistryEffect {
    const val THEME_TOGGLE = "theme.toggle"
    const val THEME_PICKER = "theme.picker"
    const val SHORTCUTS = "shortcuts.open"
    const val REFRESH = "data.refresh"
    const val TEST_ALERT = "alert.test"
    const val TOUR = "tour.start"
    const val FRECENCY_RESET = "frecency.reset"
}

/**
 * The registry commands the palette offers — the catalog-backed native port of the web `useCommandRegistry`
 * catalog (`COMMANDS`). Every label resolves through an existing `palette.cmd.*` catalog key (P1/S10). Navigate
 * actions route to real destinations through the surface's navigate callback; effect actions fire a named app
 * effect through the seam (refresh + frecency-reset are handled by the surface itself; the rest are host-wired,
 * exactly as the web `cmd.invoke()` is app-wired).
 */
val REGISTRY_COMMANDS: List<RegistryCommandConfig> =
    listOf(
        RegistryCommandConfig(
            "cmd-themeToggleMode",
            RegistrySection.Preferences,
            PaletteIconKind.Theme,
            listOf("theme", "dark", "light", "mode"),
            RegistryAction.Effect(RegistryEffect.THEME_TOGGLE),
        ),
        RegistryCommandConfig(
            "cmd-themePicker",
            RegistrySection.Preferences,
            PaletteIconKind.Theme,
            listOf("theme", "picker", "color", "appearance"),
            RegistryAction.Effect(RegistryEffect.THEME_PICKER),
        ),
        RegistryCommandConfig(
            "cmd-settings",
            RegistrySection.Preferences,
            PaletteIconKind.Settings,
            listOf("settings", "preferences", "config"),
            RegistryAction.Navigate("/settings"),
            shortcut = "g s",
        ),
        RegistryCommandConfig(
            "cmd-securitySettings",
            RegistrySection.Preferences,
            PaletteIconKind.Settings,
            listOf("security", "safety", "settings"),
            RegistryAction.Navigate("/settings/safety"),
        ),
        RegistryCommandConfig(
            "cmd-shortcuts",
            RegistrySection.Preferences,
            PaletteIconKind.Help,
            listOf("shortcuts", "keyboard", "keys", "help"),
            RegistryAction.Effect(RegistryEffect.SHORTCUTS),
            shortcut = "?",
        ),
        RegistryCommandConfig(
            "cmd-refresh",
            RegistrySection.Actions,
            PaletteIconKind.Refresh,
            listOf("refresh", "reload", "sync"),
            RegistryAction.Effect(RegistryEffect.REFRESH),
            shortcut = "g r",
        ),
        RegistryCommandConfig(
            "cmd-newAlert",
            RegistrySection.Actions,
            PaletteIconKind.Alert,
            listOf("alert", "new", "create", "rule"),
            RegistryAction.Navigate("/notifications/alerts"),
        ),
        RegistryCommandConfig(
            "cmd-testAlert",
            RegistrySection.Actions,
            PaletteIconKind.Alert,
            listOf("alert", "test", "preview"),
            RegistryAction.Effect(RegistryEffect.TEST_ALERT),
        ),
        RegistryCommandConfig(
            "cmd-export",
            RegistrySection.Actions,
            PaletteIconKind.Action,
            listOf("export", "download", "data"),
            RegistryAction.Navigate("/exports"),
        ),
        RegistryCommandConfig(
            "cmd-tour",
            RegistrySection.Actions,
            PaletteIconKind.Help,
            listOf("tour", "guide", "onboarding", "walkthrough"),
            RegistryAction.Effect(RegistryEffect.TOUR),
        ),
        RegistryCommandConfig(
            "cmd-frecencyReset",
            RegistrySection.Actions,
            PaletteIconKind.Refresh,
            listOf("reset", "frecency", "clear", "most used"),
            RegistryAction.Effect(RegistryEffect.FRECENCY_RESET),
        ),
        RegistryCommandConfig(
            "cmd-systemStatus",
            RegistrySection.Pages,
            PaletteIconKind.Page,
            listOf("system", "status", "health"),
            RegistryAction.Navigate("/system-status"),
        ),
        RegistryCommandConfig(
            "cmd-commandHistory",
            RegistrySection.Pages,
            PaletteIconKind.Page,
            listOf("command", "history", "log"),
            RegistryAction.Navigate("/command-history"),
        ),
        RegistryCommandConfig(
            "cmd-apiPlayground",
            RegistrySection.Pages,
            PaletteIconKind.Page,
            listOf("api", "playground", "request"),
            RegistryAction.Navigate("/api-playground"),
        ),
        RegistryCommandConfig(
            "cmd-notificationsHistory",
            RegistrySection.Pages,
            PaletteIconKind.Notification,
            listOf("notifications", "history", "inbox"),
            RegistryAction.Navigate("/notifications/inbox"),
        ),
        RegistryCommandConfig(
            "cmd-help",
            RegistrySection.Pages,
            PaletteIconKind.Help,
            listOf("help", "docs", "support", "roadmap"),
            RegistryAction.Navigate("/roadmap"),
        ),
        RegistryCommandConfig(
            "cmd-changelog",
            RegistrySection.Pages,
            PaletteIconKind.Page,
            listOf("changelog", "release", "notes", "whats new"),
            RegistryAction.Navigate("/roadmap"),
        ),
    )

/** The icon identity for a live entity-search hit type — the native port of the web `searchHitIcon`. */
fun searchHitIconKind(type: SearchHitType): PaletteIconKind =
    when (type) {
        SearchHitType.Vehicle -> PaletteIconKind.Vehicle
        SearchHitType.Drive -> PaletteIconKind.Drive
        SearchHitType.Charging -> PaletteIconKind.Charging
        SearchHitType.Alert -> PaletteIconKind.Alert
        SearchHitType.Notification -> PaletteIconKind.Notification
        SearchHitType.Geofence -> PaletteIconKind.Geofence
        SearchHitType.Automation -> PaletteIconKind.Automation
        SearchHitType.Location -> PaletteIconKind.Location
        SearchHitType.Trip -> PaletteIconKind.Trip
    }

/** A projected search-hit row carrying the id, label, sublabel, target url, and icon (render localizes the section). */
data class PaletteSearchHit(
    val id: Long,
    val type: SearchHitType,
    val title: String,
    val subtitle: String?,
    val url: String,
    val icon: PaletteIconKind,
)

/** Projects raw [SearchHit]s onto render-ready rows (web `searchResultItems`). */
fun projectSearchHits(hits: List<SearchHit>): List<PaletteSearchHit> =
    hits.map { PaletteSearchHit(it.id, it.type, it.title, it.subtitle, it.url, searchHitIconKind(it.type)) }

/** Whether the "View all results" footer affordance shows — non-empty hits and a >= 2 char term (web `showViewAllResults`). */
fun showViewAllResults(
    hitCount: Int,
    term: String,
): Boolean = hitCount > 0 && term.trim().length >= MIN_VIEW_ALL_TERM

/**
 * The complete inventory of i18n catalog keys this surface resolves (P1/S10). The render boundary resolves each
 * via `R.string.translation_*` (compile-checked); this list documents the contract and is asserted complete +
 * unique + catalog-prefixed by the model test. Every name maps to an `<string name="…">` shipped in
 * `res/values/strings.xml` (and the ar/he fallbacks).
 */
object CommandPaletteKeys {
    /** Section headers (web `palette.section.*`). */
    val SECTIONS: List<String> =
        listOf(
            "translation_palette_section_pages",
            "translation_palette_section_commands",
            "translation_palette_section_vehicles",
            "translation_palette_section_preferences",
            "translation_palette_section_actions",
            "translation_palette_section_mostUsed",
            "translation_palette_section_recent",
            "translation_palette_section_selectVehicle",
        )

    /** Per-type live-search section headers (web `search.section.*`). */
    val SEARCH_SECTIONS: List<String> =
        listOf(
            "translation_search_section_vehicle",
            "translation_search_section_drive",
            "translation_search_section_charging",
            "translation_search_section_alert",
            "translation_search_section_notification",
            "translation_search_section_geofence",
            "translation_search_section_automation",
            "translation_search_section_location",
            "translation_search_section_trip",
            "translation_search_section_results",
        )

    /** Chrome + microcopy (web `palette.*` / `search.palette.*` / `common.*`). */
    val CHROME: List<String> =
        listOf(
            "translation_palette_placeholder", // parity:allow catalog key name for the palette search hint (web palette.placeholder)
            "translation_palette_noVehicles",
            "translation_palette_noResults",
            "translation_palette_navigate",
            "translation_palette_select",
            "translation_palette_back",
            "translation_palette_close",
            "translation_palette_vehicle",
            "translation_palette_vehicles",
            "translation_palette_selectVehicleFor",
            "translation_palette_shortcut",
            "translation_palette_cmd_selectVehicle",
            "translation_palette_cmd_switchVehicle",
            "translation_palette_recent_justNow",
            "translation_palette_recent_minutesAgo",
            "translation_palette_recent_hoursAgo",
            "translation_palette_recent_daysAgo",
            "translation_search_palette_viewAll",
            "translation_common_loading",
            "translation_common_offline",
            "translation_common_retry",
            "translation_common_clear",
            "translation_common_vehicle",
            "translation_mqtt_stale",
            "translation_freshness_updating",
        )

    /** Every catalog key the surface resolves, in section → search → chrome order. */
    val ALL: List<String> = SECTIONS + SEARCH_SECTIONS + CHROME
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** Structured-log field key carrying the surface slug on every diagnostic. */
const val SURFACE_KEY: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [CommandPaletteRegistration.SLUG]
 * (P1/S11) — never a query, vehicle id, VIN, or any user content, so a diagnostics line can never leak the
 * operator's fleet state or what they searched for. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the ViewModel calls it once per surface open.
 */
fun recordCommandPaletteViewOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to CommandPaletteRegistration.SLUG))
}

private const val MOST_USED_PREFIX = "most-used-"
private const val MIN_VIEW_ALL_TERM = 2
private val WORD_SPLIT = Regex("[^\\p{L}\\p{N}]+")

private const val MINUTE_MS = 60_000L
private const val HOUR_MS = 3_600_000L
private const val DAY_MS = 86_400_000L
private const val WEEK_MS = 604_800_000L
private const val MONTH_MS = 2_592_000_000L
private const val MINUTES_PER_HOUR = 60
private const val MINUTES_PER_DAY = 1_440

private const val WEIGHT_HOUR = 100.0
private const val WEIGHT_DAY = 50.0
private const val WEIGHT_WEEK = 25.0
private const val WEIGHT_MONTH = 10.0
private const val WEIGHT_OLD = 5.0
