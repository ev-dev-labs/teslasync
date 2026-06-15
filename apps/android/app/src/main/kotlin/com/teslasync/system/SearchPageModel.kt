// Pure, framework-free metadata + domain model for the SearchPage system surface — the native analogue of the
// cross-cutting concerns + derivations the web page owns (web/src/features/system/pages/SearchPage.tsx, the
// app-wide unified-search page mounted at /search). No Compose, no Android framework, no HTTP lives here, so the
// route identity, the canonical entity-type ordering, the `groupedHits` derivation, and the cache-then-network
// Resource fold are all exercised off-device and the composable stays a thin render layer.
//
// The web page reads ONE source — `useGlobalSearch(trimmed, { types, limit: 25, disabled: tooShort })` — and then
// groups the flat `hits` array into per-type sections in display order, dropping empty groups (the page-local
// `groupedHits` memo, NOT the hook). This port reproduces that grouping here in [groupHits] so the same grouping is
// unit-tested without a device, and folds the grouped result into the SAME freshness-preserving [Resource] envelope
// the shared SearchRepository feed carries ([searchResultsResource]). No field is unit-bearing (titles, urls,
// scores, timestamps), so there is no SI conversion at this layer — display formatting is the render boundary's job.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling Commands / Diagnostic system
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.search

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.search.SearchHit
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchResponse

/**
 * Canonical metadata for the SearchPage surface. The web page is a top-level route, so this object carries the
 * cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a
 * metadata-only destination at Destinations.kt `page("search", "/search", NavGroup.Search)`), the diagnostics
 * [SLUG] emitted with the one-shot `view.opened` event (P1/S11), and the in-app deep-link prefix each result row
 * follows (web `navigate(hit.url)`).
 */
object SearchPageRegistration {
    /** The navigation destination id (Destinations.kt `page("search", "/search", NavGroup.Search)`). */
    const val ROUTE_ID: String = "search"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/search"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); never carries the query text. */
    const val SLUG: String = "SearchPage"

    /**
     * The in-app deep-link prefix each result row opens — the native analogue of the web `navigate(hit.url)`. No
     * `NavController` is exposed to page hosts, so the app's own `teslasync://app/{path}` deep-link scheme
     * (AndroidManifest + TeslaSyncNavHost) is the sanctioned forward-navigation seam, opened via `LocalUriHandler`.
     * Each `hit.url` already starts with `/`, so the opened URI is `teslasync://app` + `hit.url`.
     */
    const val DEEP_LINK_PREFIX: String = "teslasync://app"
}

/**
 * Per-type LIMIT the page passes to the backend — the web `limit: 25` (clamped server-side to `[1, 25]`). Bumped
 * from the command palette's 5-per-type preview so the full page shows materially more rows.
 */
const val SEARCH_PER_TYPE_LIMIT: Int = 25

/**
 * Every entity type the backend can return, in display order — the verbatim port of the web `ALL_TYPES` array
 * (web/src/features/system/pages/SearchPage.tsx). Kept in this order so the facet-chip rail and the grouped
 * results render predictably (vehicle ▸ drive ▸ charging ▸ alert ▸ notification ▸ geofence ▸ automation ▸
 * location ▸ trip).
 */
val SEARCH_TYPE_ORDER: List<SearchHitType> =
    listOf(
        SearchHitType.Vehicle,
        SearchHitType.Drive,
        SearchHitType.Charging,
        SearchHitType.Alert,
        SearchHitType.Notification,
        SearchHitType.Geofence,
        SearchHitType.Automation,
        SearchHitType.Location,
        SearchHitType.Trip,
    )

/**
 * One grouped per-type results section — the native analogue of one `{ type, hits }` entry in the web
 * `groupedHits` memo. [hits] preserves the backend's within-type ordering and is never empty (empty groups are
 * dropped by [groupHits]).
 */
data class SearchSection(
    val type: SearchHitType,
    val hits: List<SearchHit>,
)

/**
 * The immutable success surface the ViewModel exposes and the page renders — the server-echoed [query] (used to
 * fill the web `search.noResults.message` `%1$s` format slot) plus the per-type [groups]. [hasResults] mirrors the
 * web `groupedHits.length > 0` content branch.
 */
data class SearchResultsModel(
    val query: String,
    val groups: List<SearchSection>,
) {
    /** Whether any group has hits (web `groupedHits.length > 0`). */
    val hasResults: Boolean get() = groups.isNotEmpty()
}

/**
 * Groups a flat [hits] list into per-type [SearchSection]s in [SEARCH_TYPE_ORDER], dropping empty groups — the
 * verbatim port of the web `groupedHits` memo (build a per-type map, then map ALL_TYPES → { type, hits } and
 * filter `hits.length > 0`). A hit whose type is outside the known set is skipped, exactly as the web `groups.has`
 * guard does. Pure, so the grouping/ordering is unit-tested without a device.
 */
fun groupHits(hits: List<SearchHit>): List<SearchSection> {
    val byType: Map<SearchHitType, List<SearchHit>> = hits.groupBy { it.type }
    return SEARCH_TYPE_ORDER.mapNotNull { type ->
        val typeHits = byType[type].orEmpty()
        if (typeHits.isEmpty()) null else SearchSection(type = type, hits = typeHits)
    }
}

/** Projects a raw [SearchResponse] into the grouped [SearchResultsModel] (web `groupedHits` over `data.hits`). */
fun searchResultsModel(response: SearchResponse): SearchResultsModel =
    SearchResultsModel(query = response.query, groups = groupHits(response.hits))

/**
 * The settled empty result a disabled / too-short / empty query resolves to WITHOUT a network request — the web
 * hook's documented "empty hits array (without making a request)" branch. A [Resource.Success] (not Loading) so the
 * UI shows no spinner for a 0–1 character query (web `enabled: false` ⇒ `isLoading` stays false). `fetchedAt` is 0
 * because no fetch occurred. [query] is trimmed so the echoed value matches the web `trimmed`.
 */
fun skipSearchResults(query: String): Resource<SearchResultsModel> =
    Resource.Success(
        data = SearchResultsModel(query = query.trim(), groups = emptyList()),
        fetchedAt = 0L,
        stale = false,
    )

/**
 * Folds a raw `GET /search` [Resource] into a [Resource] of the grouped [SearchResultsModel], preserving every
 * freshness flag (cached / refreshing / stale / offline) so the bound state holder renders the full data-state
 * matrix (loading → empty → success → error, plus stale/offline) from one source. Pure, so the parse-and-preserve
 * contract is unit-tested without a network or cache.
 */
fun searchResultsResource(resource: Resource<SearchResponse>): Resource<SearchResultsModel> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = resource.cached?.let(::searchResultsModel),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = searchResultsModel(resource.data),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = resource.cached?.let(::searchResultsModel),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). Carries ONLY the non-PII surface
 * slug — never the operator's query text — so a diagnostics line can never leak what was searched.
 */
internal fun recordSearchPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SearchPageRegistration.SLUG))
}
