// Pure, framework-free model + projection for the SearchInput shared surface — the native analogue of the
// data the web component derives before returning JSX (web/src/components/forms/SearchInput.tsx). No Compose,
// no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so the
// composable stays a thin render layer.
//
// The web `SearchInput` is a debounced search field that, when a `historyScope` is set, exposes a
// "recent searches" dropdown backed by `@/lib/searchHistory` (a per-scope localStorage envelope). This model
// reproduces that history algebra EXACTLY — trim + minimum-length filtering, case-insensitive de-duplication
// (newest submission wins, keeping its original casing), newest-first ordering, and a per-scope capacity cap —
// and folds the recent-search list's cache-then-network lifecycle into the prompt's loading / content / empty /
// error / stale / offline matrix so the surface never hides a region.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/SearchInput — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.searchinput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the history limits (`MIN_QUERY_LEN` / `CAP` from `@/lib/searchHistory`, plus the
 * dropdown's default `maxHistory`) are pinned here so the native and web surfaces stay in lockstep.
 */
object SearchInputRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SearchInput"

    /** Minimum length (after trimming) for a query to be recorded — web `MIN_QUERY_LEN`. */
    const val MIN_QUERY_LEN: Int = 2

    /** Maximum entries retained per scope; oldest entries are evicted — web `CAP`. */
    const val CAP: Int = 12

    /** Default number of dropdown rows rendered — web `maxHistory` prop default. */
    const val DEFAULT_MAX_HISTORY: Int = 8
}

/**
 * One recorded search — the native port of the web `HistoryEntry` (`{ q, ts }`). [query] keeps the original
 * casing the user submitted; [timestampMs] is the wall-clock millisecond of the most recent submission.
 */
data class SearchHistoryEntry(
    val query: String,
    val timestampMs: Long,
)

/**
 * True when [query] is worth recording — the native port of the web guard
 * `query.trim().length >= MIN_QUERY_LEN`. Whitespace-only and single-character noise is rejected so callers
 * can fire on every blur / IME-search without polluting the list.
 */
fun shouldRecordQuery(
    query: String,
    minLen: Int = SearchInputRegistration.MIN_QUERY_LEN,
): Boolean = query.trim().length >= minLen

/**
 * Records [query] into [existing] — the native port of web `recordSearch`. Trims, drops below-minimum noise
 * (returning [existing] unchanged), removes any case-insensitive duplicate so the new submission (with its
 * current casing + [nowMs]) takes the top slot, and caps the list at [cap], newest-first.
 */
fun recordHistory(
    existing: List<SearchHistoryEntry>,
    query: String,
    nowMs: Long,
    cap: Int = SearchInputRegistration.CAP,
): List<SearchHistoryEntry> {
    val trimmed = query.trim()
    if (trimmed.length < SearchInputRegistration.MIN_QUERY_LEN) return existing
    val lower = trimmed.lowercase()
    val deduped = existing.filterNot { it.query.lowercase() == lower }
    return (listOf(SearchHistoryEntry(trimmed, nowMs)) + deduped).take(cap.coerceAtLeast(0))
}

/**
 * Removes the case-insensitive match for [query] from [existing] — the native port of web `removeSearch`.
 * Returns [existing] unchanged when the query is blank or absent.
 */
fun removeHistory(
    existing: List<SearchHistoryEntry>,
    query: String,
): List<SearchHistoryEntry> {
    val lower = query.trim().lowercase()
    if (lower.isEmpty()) return existing
    return existing.filterNot { it.query.lowercase() == lower }
}

/**
 * Projects [entries] onto up to [max] recent query strings, newest-first — the native port of web
 * `getRecentSearches`. The limit is clamped into `[0, cap]` exactly like the web `Math.min(max, CAP)`.
 */
fun recentQueries(
    entries: List<SearchHistoryEntry>,
    max: Int = SearchInputRegistration.DEFAULT_MAX_HISTORY,
    cap: Int = SearchInputRegistration.CAP,
): List<String> {
    val limit = max.coerceIn(0, cap.coerceAtLeast(0))
    return entries.take(limit).map { it.query }
}

/**
 * The mutually-exclusive render surface the history dropdown draws. [Content] reproduces the web's visible
 * list; [Empty]/[Loading]/[Error] surface the recent-search feed's async lifecycle so the dropdown honestly
 * renders every state from the prompt's matrix instead of collapsing to a blank box.
 */
enum class SearchHistoryPhase {
    /** First load of the recent-search feed with nothing cached — render shimmering rows. */
    Loading,

    /** At least one recent search is available — render the selectable list. */
    Content,

    /** The feed resolved with no recent searches — render a friendly empty state, never a blank box. */
    Empty,

    /** The feed failed with nothing cached to fall back on — render a classified error + retry. */
    Error,
}

/**
 * The immutable, render-ready projection the dropdown draws: the resolved [entries] plus the cache-then-network
 * freshness envelope ([stale]/[offline]/[refreshing] + [errorKind]) so a cached list is honestly flagged as
 * last-known rather than presented as live. Pure data so [SearchInputProjection] is unit-tested without a UI
 * host.
 *
 * @property stale cached entries are past their TTL and a refresh is in flight (no failure yet).
 * @property offline cached entries are shown because a refresh failed (network unreachable / "last known").
 * @property freshnessStamp the `fetchedAt` of the shown entries; keys the stale auto-refresh effect.
 */
data class SearchHistoryDisplay(
    val phase: SearchHistoryPhase,
    val entries: List<String>,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale or offline) should be shown over the cached list. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == SearchHistoryPhase.Error
}

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the composable a thin render layer and every string resolved
 * through the P1/S10 catalog.
 *
 * @property searchHint the field's floating label (the web empty-field prompt / `common.search`).
 * @property clearLabel the clear-button accessible label (web `clearLabel` / `common.clear`).
 * @property historyTitle the dropdown heading (web `search.history.title`).
 * @property clearHistoryLabel the wipe-all action label (web `search.history.clear`).
 * @property removeAriaTemplate the per-entry remove label template (web `search.history.removeAria`, `%1$s`).
 * @property emptyMessage the friendly empty-state body when there are no recent searches.
 * @property loadingLabel the TalkBack label for the loading rows.
 * @property staleLabel the freshness chip shown when the cached list is past its TTL.
 * @property offlineLabel the freshness chip shown when the cached list is served after a failed refresh.
 */
data class SearchInputStrings(
    val searchHint: String,
    val clearLabel: String,
    val historyTitle: String,
    val clearHistoryLabel: String,
    val removeAriaTemplate: String,
    val emptyMessage: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
) {
    /** The spoken remove label for [query] — the native port of web `t('search.history.removeAria', { query })`. */
    fun removeLabel(query: String): String = formatRemoveLabel(removeAriaTemplate, query)
}

/** Token the Android `removeAria` resource interpolates the query into (positional first argument). */
private const val REMOVE_QUERY_TOKEN: String = "%1\$s"

/**
 * Folds [query] into the `removeAria` [template] — locale-safe (a literal token substitution, never
 * `String.format`). A template with no token degrades to "template query" so the label is always meaningful.
 */
fun formatRemoveLabel(
    template: String,
    query: String,
): String = if (template.contains(REMOVE_QUERY_TOKEN)) template.replace(REMOVE_QUERY_TOKEN, query) else "$template $query"

/**
 * Pure projection logic for the SearchInput history dropdown — folds the recent-search feed's lifecycle
 * ([UiState]) into the render-ready [SearchHistoryDisplay], reproducing the web's visible list while adding the
 * stale/offline freshness fold the sibling surfaces use.
 */
object SearchInputProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Folds the recent-search [state] into the render-ready [SearchHistoryDisplay]. Phase resolution honours
     * both the web's visible list and the feed's async lifecycle: a hard failure with no cache →
     * [SearchHistoryPhase.Error]; a first load with nothing cached → [SearchHistoryPhase.Loading]; an empty
     * resolved list → [SearchHistoryPhase.Empty]; otherwise → [SearchHistoryPhase.Content].
     */
    fun project(state: UiState<List<String>>): SearchHistoryDisplay {
        val entries = state.data ?: emptyList()
        val phase =
            when {
                state.isError -> SearchHistoryPhase.Error
                state.isLoading -> SearchHistoryPhase.Loading
                entries.isEmpty() -> SearchHistoryPhase.Empty
                else -> SearchHistoryPhase.Content
            }
        return SearchHistoryDisplay(
            phase = phase,
            entries = entries,
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface shows
     * the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: SearchHistoryDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). Carries no query text or
 * scope — only the surface slug — so search terms never leak through diagnostics. The one-per-holder guard
 * lives in [SearchInputViewModel.onViewOpened].
 */
fun recordSearchInputOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_FIELD_KEY to SearchInputRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED: String = "view.opened"
private const val SURFACE_FIELD_KEY: String = "surface"
