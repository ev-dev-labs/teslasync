// Pure, framework-free model + projections for the ExplorePage feature-hub surface — the native analogue of
// everything the web page derives before composing its JSX (web/src/features/explore/pages/ExplorePage.tsx and
// its backing web/src/features/explore/featureCatalog.ts + web/src/lib/closestRoute.ts). No Compose, no Android
// UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core Vehicle DTO + the
// cache-then-network Resource), so the composable stays a thin render layer and this logic is unit-testable
// off-device, exactly as the sibling A7 page models are.
//
// The web page owns these concerns this file ports: (1) the catalog visibility gate (web `visibleCatalog`:
// `minVehicles`/`requiresAuth` predicates over the sidebar nav, bound to `useVehicles` + `useIsForwardAuth`);
// (2) the AND-token filter over label/section/description/path (web `filterFeatureCatalog`); (3) the
// order-preserving grouping by section (web `groupFeatureCatalog`); (4) the query-token highlight splitter (web
// `Highlight`); (5) the Levenshtein "did you mean" engine (web `closestRoutes`); and (6) the gate Resource fold
// that drapes the page's freshness over the vehicle-list feed. The localized label/section/description text is
// resolved at the Compose boundary (ExplorePage.kt) from the already-localized nav catalog (ADR-014) and folded
// into the [ExploreEntry]s this model filters/groups — the LayoutStrings precedent.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/explore) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.explore

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `ExplorePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("explore", "/explore", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/explore` deep link) without the nav module depending on it.
 */
object ExplorePageRegistration {
    /** The navigation destination id (Destinations.kt `page("explore", "/explore", …)`). */
    const val ROUTE_ID: String = "explore"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/explore"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
    const val SLUG: String = "ExplorePage"

    /** Recently-visited rows shown at most (web `RECENT_LIMIT`). */
    const val RECENT_LIMIT: Int = 6
}

/**
 * Visibility gating constants — the native mirror of the two web `navSections` item predicates the page honors
 * (web/src/components/layout/Layout.tsx `isVisibleNavItem`): a `minVehicles` floor and a `requiresAuth` flag.
 * Pinned here so the hub surfaces exactly what the sidebar would, in lockstep with the web source.
 */
object ExploreGating {
    /** Vehicles needed before a destination is shown (web `minVehicles`); `/vehicle-comparison` needs two. */
    val MIN_VEHICLES: Map<String, Int> = mapOf("fleetCompare" to MIN_VEHICLES_COMPARE)

    /**
     * Destination ids hidden until the deployment runs behind a ForwardAuth identity provider — the native
     * mirror of the web nav items flagged `requiresAuth`, whose endpoints 503 in open mode.
     */
    val REQUIRES_AUTH: Set<String> = setOf("myActivity", "account2fa", "accountSessions")

    private const val MIN_VEHICLES_COMPARE = 2

    /**
     * True when [id] should be shown for the current fleet/auth context — the native port of the web
     * `visibleCatalog` filter (`minVehicles && vehicleCount < minVehicles → hide`;
     * `requiresAuth && !isForwardAuth → hide`).
     */
    fun isVisible(
        id: String,
        vehicleCount: Int,
        isForwardAuth: Boolean,
    ): Boolean {
        val floor = MIN_VEHICLES[id]
        if (floor != null && vehicleCount < floor) return false
        if (id in REQUIRES_AUTH && !isForwardAuth) return false
        return true
    }
}

/**
 * One catalog entry the page renders as a feature card — the native mirror of the web `FeatureCatalogEntry`,
 * with its localized text already resolved at the Compose boundary (the LayoutStrings precedent). [id] is the
 * navigation destination id (used to resolve the card icon + to navigate), [path] the web route (the dedup key,
 * matched against recent-page paths and folded into the search haystack), and [label]/[section]/[description]
 * the localized strings the filter, grouping, and highlight operate on.
 */
data class ExploreEntry(
    val id: String,
    val path: String,
    val label: String,
    val section: String,
    val description: String,
)

/** A section band of entries — the native mirror of the web `{ section, entries }` group record. */
data class ExploreSection(
    val section: String,
    val entries: List<ExploreEntry>,
)

/** One highlight run of a card label/description — [isMatch] true when it equals a query token (web `<mark>`). */
data class HighlightSegment(
    val text: String,
    val isMatch: Boolean,
)

/** A "did you mean" suggestion — the native mirror of the web `RouteSuggestion` (label + path + edit distance). */
data class ExploreSuggestion(
    val path: String,
    val label: String,
    val distance: Int,
)

/**
 * The resolved gate the page binds — the fleet size + deployment auth mode the catalog visibility filter reads
 * (web `vehicleCount` + `isForwardAuth`). Always present (defaulting to `0` / `false` before the feeds resolve,
 * exactly as the web hooks default), so the catalog renders immediately and is never gated behind a spinner.
 */
data class ExploreGate(
    val vehicleCount: Int,
    val isForwardAuth: Boolean,
)

/**
 * Fold the fleet count + auth mode into the SAME cache-then-network [Resource] envelope the vehicle-list feed
 * carried, so the bound state holder drapes the page's freshness (refreshing / stale / offline + retry) over the
 * catalog without ever hiding it. The gate is always present (web defaults `vehicleCount` to `0`), so the page
 * is never structurally empty at the feed level — the page's own "no results" empty is a render-layer concern of
 * the query, exactly as the web `grouped.length === 0` branch is. Pure, so the fold is unit-tested off-device.
 */
fun exploreGateResource(
    vehicles: Resource<List<Vehicle>>,
    isForwardAuth: Boolean,
): Resource<ExploreGate> {
    val gate = ExploreGate(vehicleCount = vehicles.cached?.size ?: 0, isForwardAuth = isForwardAuth)
    return when (vehicles) {
        is Resource.Loading -> Resource.Loading(cached = gate, fetchedAt = vehicles.fetchedAt, stale = vehicles.stale)
        is Resource.Success -> Resource.Success(data = gate, fetchedAt = vehicles.fetchedAt, stale = vehicles.stale)
        is Resource.Error ->
            Resource.Error(cached = gate, fetchedAt = vehicles.fetchedAt, stale = vehicles.stale, error = vehicles.error)
    }
}

/**
 * Case-insensitive AND-token match against label, section, description, and path — the verbatim port of the web
 * `filterFeatureCatalog`. An empty/blank query returns [entries] unchanged; otherwise every whitespace-split
 * token must be a substring of the combined haystack.
 */
fun filterExploreCatalog(
    entries: List<ExploreEntry>,
    query: String,
): List<ExploreEntry> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return entries
    val tokens = q.split(WHITESPACE).filter { it.isNotEmpty() }
    if (tokens.isEmpty()) return entries
    return entries.filter { entry ->
        val haystack = "${entry.label} ${entry.section} ${entry.description} ${entry.path}".lowercase()
        tokens.all { haystack.contains(it) }
    }
}

/**
 * Group a flat catalog by section, preserving first-appearance order — the native port of the web
 * `groupFeatureCatalog` (which preserves `navSections` order). The catalog is already built in nav order, so
 * first-appearance grouping reproduces the web's section ordering exactly.
 */
fun groupExploreCatalog(entries: List<ExploreEntry>): List<ExploreSection> {
    val buckets = LinkedHashMap<String, MutableList<ExploreEntry>>()
    for (entry in entries) buckets.getOrPut(entry.section) { mutableListOf() }.add(entry)
    return buckets.map { (section, items) -> ExploreSection(section, items) }
}

/**
 * Split [text] into highlight runs, marking the runs that equal a query token — the native port of the web
 * `Highlight` splitter (no innerHTML, plain string splitting). An empty/blank query yields a single unmarked run
 * (web's early `return <>{text}</>`).
 */
fun highlightExplore(
    text: String,
    query: String,
): List<HighlightSegment> {
    val tokens = query.trim().lowercase().split(WHITESPACE).filter { it.isNotEmpty() }
    if (tokens.isEmpty()) return listOf(HighlightSegment(text, isMatch = false))
    val tokenSet = tokens.toSet()
    val pattern = tokens.joinToString("|") { Regex.escape(it) }
    val regex = Regex("($pattern)", RegexOption.IGNORE_CASE)
    val segments = mutableListOf<HighlightSegment>()
    var cursor = 0
    for (match in regex.findAll(text)) {
        val start = match.range.first
        val endExclusive = match.range.last + 1
        if (start > cursor) segments.add(HighlightSegment(text.substring(cursor, start), isMatch = false))
        val matched = text.substring(start, endExclusive)
        segments.add(HighlightSegment(matched, isMatch = tokenSet.contains(matched.lowercase())))
        cursor = endExclusive
    }
    if (cursor < text.length) segments.add(HighlightSegment(text.substring(cursor), isMatch = false))
    return segments.ifEmpty { listOf(HighlightSegment(text, isMatch = false)) }
}

/**
 * Up to [limit] closest-route suggestions for a no-results [query], ranked by Levenshtein edit distance — the
 * native port of the web `closestRoutes` (run over the visible catalog labels + paths, the web `fromLabels`
 * source). Distance is the minimum of the path- and label-distances (both normalized to alphanumerics);
 * candidates beyond [MAX_DISTANCE] edits are dropped; ties break by path for a stable order.
 */
fun closestExploreRoutes(
    query: String,
    entries: List<ExploreEntry>,
    limit: Int = DEFAULT_SUGGESTIONS,
): List<ExploreSuggestion> {
    val q = normalizeRoute(query)
    if (q.isEmpty()) return emptyList()
    val scored =
        entries.mapNotNull { entry ->
            val distance = minOf(levenshtein(q, normalizeRoute(entry.path)), levenshtein(q, normalizeRoute(entry.label)))
            if (distance <= MAX_DISTANCE) ExploreSuggestion(entry.path, entry.label, distance) else null
        }
    return scored.sortedWith(compareBy({ it.distance }, { it.path })).take(limit)
}

/** Lower-cases and strips whitespace/`-`/`_`/`/` — the web `closestRoute` `normalize`. */
private fun normalizeRoute(value: String): String = value.lowercase().replace(ROUTE_STRIP, "")

/** Iterative two-row Levenshtein (O(m*n) time, O(min) space) — the web `closestRoute` `levenshtein`. */
@Suppress("ReturnCount")
fun levenshtein(
    a: String,
    b: String,
): Int {
    if (a == b) return 0
    if (a.isEmpty()) return b.length
    if (b.isEmpty()) return a.length
    val source = if (a.length > b.length) b else a
    val target = if (a.length > b.length) a else b
    var previous = IntArray(source.length + 1) { it }
    var current = IntArray(source.length + 1)
    for (j in 1..target.length) {
        current[0] = j
        for (i in 1..source.length) {
            val cost = if (source[i - 1] == target[j - 1]) 0 else 1
            current[i] = minOf(current[i - 1] + 1, previous[i] + 1, previous[i - 1] + cost)
        }
        val swap = previous
        previous = current
        current = swap
    }
    return previous[source.length]
}

/**
 * Emit the one PII-safe `view.opened` diagnostic with the surface [ExplorePageRegistration.SLUG] (P1/S11).
 * Carries no route, query, or fleet data, so a diagnostics line can never leak navigation history.
 */
fun recordExplorePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ExplorePageRegistration.SLUG))
}

private val WHITESPACE = Regex("\\s+")
private val ROUTE_STRIP = Regex("[\\s\\-_/]+")
private const val MAX_DISTANCE = 6
private const val DEFAULT_SUGGESTIONS = 5
