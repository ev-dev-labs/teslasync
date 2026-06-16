// Pure, framework-free model + projections for the NotFoundPage system surface — the native analogue of everything
// the web page derives before composing its panel (web/src/features/system/pages/NotFoundPage.tsx, the catch-all 404
// mounted at `/*`). No Compose, no Android framework, no HTTP lives here: every declaration is plain Kotlin, so the
// route-suggestion engine (the web `closestRoutes` Levenshtein ranking) and the empty/success projection are
// exercised off-device and the composable stays a thin render layer.
//
// The web page reads NO API — it renders from the current `location.pathname` (navigation/local state) and suggests
// the closest known routes via Levenshtein edit distance over the generated route registry (web
// `web/src/lib/routeRegistry.ts` + `web/src/lib/closestRoute.ts`). This port mirrors that exactly: the suggestion
// candidates are projected from the app's own canonical [io.teslasync.android.navigation.Destinations] route table
// (the native single-source-of-truth that mirrors `web/src/App.tsx`, the same role the web `ROUTE_REGISTRY` plays),
// excluding the parameterized routes the web registry marks `hidden` (they cannot be navigated to without supplying
// their argument) and the not-found route itself. [closestRoutes] reproduces the web two-row Levenshtein ranking
// (distance against BOTH the route path and the route label, capped + limited), and [buildNotFoundSnapshot] resolves
// the attempted-path + ranked suggestions the screen renders. The visible route labels are resolved at the render
// boundary from the platform string catalog via `navTitleRes(id)` — never hardcoded here — keeping this model free
// of Android resources and unit-testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the P3
// prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace uses,
// so the package intentionally diverges from the path — exactly as the sibling system / dashboard page surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.notfound

import io.teslasync.android.navigation.Destinations
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the NotFoundPage surface. The web page is the catch-all wildcard route that renders only from
 * navigation/local state, so this object carries just the cross-cutting concerns the surface owes: the navigation
 * [ROUTE_ID] the host wires (the pre-existing metadata-only `notFound` destination at Destinations.kt
 * `hidden("notFound", "/not-found", NavGroup.NotFound)`), the web [WEB_PATH] it mirrors, and the diagnostics [SLUG]
 * emitted with the one-shot `view.opened` event (P1/S11). There is no feed metadata because the page reads no data of
 * its own.
 */
object NotFoundPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("notFound", "/not-found", NavGroup.NotFound)`). */
    const val ROUTE_ID: String = "notFound"

    /** The web route this surface mirrors — the catch-all that matches any unknown URL (web `<Route path="*">`). */
    const val WEB_PATH: String = "/*"

    /** The concrete path a user lands on when no specific attempted URL is threaded into the surface. */
    const val DEFAULT_PATH: String = "/not-found"

    /** Optional nav argument carrying the unmatched path (web `location.pathname`), when a caller threads one. */
    const val ARG_PATH: String = "path"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NotFoundPage"
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no path/PII content. */
internal fun recordNotFoundPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to NotFoundPageRegistration.SLUG))
}

/** Furthest edit distance a candidate may sit from the query and still be offered (web `if (distance <= 6)`). */
const val MAX_SUGGESTION_DISTANCE: Int = 6

/** How many ranked suggestions the page offers at most (web `closestRoutes(..., 5)`). */
const val DEFAULT_SUGGESTION_LIMIT: Int = 5

/**
 * One navigable route the suggestion engine can rank — the native analogue of a web `routeRegistry.ts` row reduced to
 * the two fields this layer derives over: a stable [id] (whose localized label is resolved at render via
 * `navTitleRes`) and the [path] to navigate to. The web ranks distance against both the path and the label; here the
 * normalized [id] doubles as the label proxy (the app's destination ids are the camelCase of their nav titles, e.g.
 * `batteryHealth` → "Battery Health", so they normalize to the same token the web label does).
 */
data class RouteCandidate(
    val id: String,
    val path: String,
)

/**
 * One ranked suggestion the page renders — a [RouteCandidate] plus its computed Levenshtein [distance] to the
 * attempted path (web `RouteSuggestion`). Lower [distance] ranks first; the localized label is resolved at the render
 * boundary from [id].
 */
data class RouteSuggestion(
    val id: String,
    val path: String,
    val distance: Int,
)

/**
 * The immutable success surface the ViewModel exposes and the page renders. [attemptedPath] is the unmatched URL shown
 * in the body (web `location.pathname`); [suggestions] is the ranked closest-route list the "Did you mean" section
 * shows (empty when nothing is close enough, exactly as the web hides the block on `suggestions.length === 0`). The
 * surface is never structurally empty — the 404 page is a static informational surface that always has its heading,
 * body and escape-hatch actions to render (the web page renders unconditionally).
 */
data class NotFoundSnapshot(
    val attemptedPath: String,
    val suggestions: List<RouteSuggestion>,
) {
    /** True when there is at least one close-enough route to offer (web `suggestions.length > 0`). */
    val hasSuggestions: Boolean get() = suggestions.isNotEmpty()

    /** Always false — the informational 404 surface always renders content (heading + body + actions). */
    val isEmpty: Boolean get() = false
}

/**
 * The navigable suggestion candidates — projected from the app's canonical [Destinations] table (the native
 * single-source-of-truth that mirrors `web/src/App.tsx`, the same role the web `ROUTE_REGISTRY` plays). Mirrors the
 * web engine's `if (r.hidden) continue`: parameterized routes (e.g. `vehicles/{id}`) are dropped because they cannot
 * be navigated to without an argument, and the not-found route never suggests itself.
 */
fun defaultRouteCandidates(): List<RouteCandidate> =
    Destinations.all
        .asSequence()
        .filter { !it.isParameterized && it.id != NotFoundPageRegistration.ROUTE_ID }
        .map { RouteCandidate(id = it.id, path = it.webPath) }
        .toList()

/**
 * Rank the [candidates] by Levenshtein edit distance to [query], returning up to [limit] within
 * [MAX_SUGGESTION_DISTANCE] — the native port of the web `closestRoutes`. Distance is taken as the minimum of the
 * distance to the normalized path and to the normalized [RouteCandidate.id] (the label proxy), so a typo close to
 * either a path or a name still surfaces. Ties break by ascending path for a stable order. Pure, so the ranking
 * contract is unit-tested without Android.
 */
fun closestRoutes(
    query: String,
    candidates: List<RouteCandidate> = defaultRouteCandidates(),
    limit: Int = DEFAULT_SUGGESTION_LIMIT,
): List<RouteSuggestion> {
    val q = normalizeRouteToken(query)
    if (q.isEmpty()) return emptyList()

    return candidates
        .asSequence()
        .map { candidate ->
            val pathDistance = levenshtein(q, normalizeRouteToken(candidate.path))
            val labelDistance = levenshtein(q, normalizeRouteToken(candidate.id))
            RouteSuggestion(
                id = candidate.id,
                path = candidate.path,
                distance = minOf(pathDistance, labelDistance),
            )
        }.filter { it.distance <= MAX_SUGGESTION_DISTANCE }
        .sortedWith(compareBy({ it.distance }, { it.path }))
        .take(limit)
        .toList()
}

/**
 * Derive the [NotFoundSnapshot] for an [attemptedPath] — the native analogue of the web page's single derivation
 * (`closestRoutes(location.pathname, ROUTE_REGISTRY, 5)`). Blank input falls back to the canonical not-found path so
 * the body always reads naturally. Pure.
 */
fun buildNotFoundSnapshot(
    attemptedPath: String?,
    candidates: List<RouteCandidate> = defaultRouteCandidates(),
    limit: Int = DEFAULT_SUGGESTION_LIMIT,
): NotFoundSnapshot {
    val path = attemptedPath?.trim()?.takeIf { it.isNotEmpty() } ?: NotFoundPageRegistration.DEFAULT_PATH
    return NotFoundSnapshot(
        attemptedPath = path,
        suggestions = closestRoutes(query = path, candidates = candidates, limit = limit),
    )
}

/**
 * Wrap a derived [snapshot] in a terminal cache-then-network [Resource.Success] so the page renders through the same
 * lifecycle-aware [io.teslasync.android.data.UiState] surface every parity page uses (loading → empty → success), even
 * though the surface is static and never errors. [fetchedAt] stamps the synthetic load. Pure.
 */
fun notFoundSnapshotResource(
    snapshot: NotFoundSnapshot,
    fetchedAt: Long,
): Resource<NotFoundSnapshot> = Resource.Success(data = snapshot, fetchedAt = fetchedAt, stale = false)

/** Normalize a route token for distance scoring: lower-case and drop separators (web `normalize` in closestRoute.ts). */
fun normalizeRouteToken(value: String): String = value.lowercase().filter { it.isLetterOrDigit() }

/**
 * Iterative two-row Levenshtein edit distance — the native port of the web `levenshtein` (O(m*n) time, O(min(m,n))
 * space). Standard textbook implementation; no external deps.
 */
fun levenshtein(
    a: String,
    b: String,
): Int {
    if (a == b) return 0
    if (a.isEmpty()) return b.length
    if (b.isEmpty()) return a.length

    // Always iterate over the shorter string in the inner loop for cache locality (web parity).
    val shorter = if (a.length > b.length) b else a
    val longer = if (a.length > b.length) a else b

    val m = shorter.length
    val n = longer.length
    var prev = IntArray(m + 1) { it }
    var curr = IntArray(m + 1)

    for (j in 1..n) {
        curr[0] = j
        for (i in 1..m) {
            val cost = if (shorter[i - 1] == longer[j - 1]) 0 else 1
            curr[i] = minOf(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost)
        }
        val tmp = prev
        prev = curr
        curr = tmp
    }
    return prev[m]
}
