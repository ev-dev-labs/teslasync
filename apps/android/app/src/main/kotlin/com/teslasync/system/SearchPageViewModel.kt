// The state holder backing the SearchPage surface (P1/S8) — the native counterpart of the web page's single
// TanStack-Query read plus its local query/filter state (web/src/features/system/pages/SearchPage.tsx):
// `useUrlString('q')` + `useUrlArray('types')` driving `useGlobalSearch(trimmed, { types, limit: 25, disabled:
// tooShort })`. It owns the live [SearchInput] (query + the active type filter + the per-type limit), plans each
// input through the shared `planSearch` gate (the web hook's `enabled` guard), and projects the resolved search
// feed onto the shared lifecycle-aware [UiState] surface (loading → empty → success → error, plus stale/offline).
// All grouping/fold logic lives in the framework-free model (SearchPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// The query lives here (not in remembered composable state) so it — and the active filters — survive recomposition
// and configuration changes, the native analogue of the web `?q=` / `?types=` URL round-trip, hoisted into the
// lifecycle-scoped holder per ADR-002. A new input cancels the in-flight read for the previous one (the web
// `AbortSignal`) via `flatMapLatest`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.search

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchInput
import io.teslasync.shared.core.presentation.search.SearchOptions
import io.teslasync.shared.core.presentation.search.SearchRequestPlan
import io.teslasync.shared.core.presentation.search.planSearch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the real shared SearchRepository feed ↔ a test fake); the view never performs
 *   HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the PII-safe `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchPageViewModel(
    private val source: SearchPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInput =
        MutableStateFlow(SearchInput(query = "", options = SearchOptions(limit = SEARCH_PER_TYPE_LIMIT)))
    private var viewOpenedRecorded = false

    /**
     * The live query + filter input the page's search field and facet-chip rail render and mutate (web `q` +
     * `types`). Hoisted so it survives recomposition / config changes; updated via [setQuery] / [toggleType] /
     * [clearFilters].
     */
    val input: StateFlow<SearchInput> = mutableInput.asStateFlow()

    /**
     * The resolved page snapshot as a lifecycle-aware [UiState]: a disabled / too-short / empty query settles to an
     * empty success WITHOUT a request (web `enabled: false`); an enabled query streams cache-then-network through
     * the [source] — loading (first load, no cache) → content (grouped hits) → empty (no hits) → error (hard
     * failure), plus stale/offline. Re-plans and re-collects on every [input] change, cancelling the prior read.
     */
    val uiState: StateFlow<UiState<SearchResultsModel>> =
        mutableInput
            .flatMapLatest { input -> resolve(input) }
            .asUiState(isEmpty = { it.groups.isEmpty() })

    /** Sets the raw query, leaving the active type filter unchanged (web `setQuery` on the URL `q` param). */
    fun setQuery(query: String) {
        mutableInput.update { it.copy(query = query) }
    }

    /**
     * Toggles a facet [type] in/out of the active filter, preserving the requested ordering across the round-trip
     * (web `toggleType`: append when absent, drop when present). Leaves the query + limit unchanged.
     */
    fun toggleType(type: SearchHitType) {
        mutableInput.update { current ->
            val types = current.options.types
            val next = if (types.contains(type)) types.filterNot { it == type } else types + type
            current.copy(options = current.options.copy(types = next))
        }
    }

    /** Clears the active type filter (web `clearFilters`: `setActiveTypes([])`). A no-op when already empty. */
    fun clearFilters() {
        mutableInput.update { current ->
            if (current.options.types.isEmpty()) {
                current
            } else {
                current.copy(options = current.options.copy(types = emptyList()))
            }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no query text. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSearchPageOpened(logger)
    }

    /**
     * Plans an [input] exactly as the web `useGlobalSearch` hook does (the shared `planSearch`): a too-short /
     * disabled query is a [SearchRequestPlan.Skip] that settles to empty hits with no request (web `enabled:
     * false`); an enabled query is a [SearchRequestPlan.Fetch] streamed cache-then-network through the [source] and
     * folded into the grouped [SearchResultsModel], every freshness flag preserved.
     */
    private fun resolve(input: SearchInput): Flow<Resource<SearchResultsModel>> =
        when (val plan = planSearch(input)) {
            SearchRequestPlan.Skip -> flowOf(skipSearchResults(input.query))
            is SearchRequestPlan.Fetch ->
                source.search(plan.query, plan.types, plan.limit).map(::searchResultsResource)
        }

    companion object {
        /** Wire the surface from a host-supplied [source]. The holder runs on `viewModelScope`. */
        fun create(
            source: SearchPageSource,
            logger: Logger,
        ): SearchPageViewModel = SearchPageViewModel(source = source, logger = logger)
    }
}
