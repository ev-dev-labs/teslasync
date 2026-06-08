package io.teslasync.shared.core.presentation.search

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SearchRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for unified entity search — the cross-platform port of the web
 * `useSearch` hook domain (web/src/api/hooks/useSearch.ts). Every native search surface (the command
 * palette and the full-results page on Android/Apple via KMP, Windows via the C# port) binds to this
 * single holder rather than re-implementing the endpoint, the query keys, or the min-length gating.
 *
 * Unlike the per-key-feed S8 holders, a search box is a SINGLE dynamic input (the query changes on
 * every keystroke), so this holder keys nothing: it exposes one mutable [input] and folds it with
 * `flatMapLatest` into one shared [results] feed, exactly as one `useGlobalSearch(query, options)`
 * hook instance re-runs when its arguments change. A new input cancels the in-flight read for the
 * previous one (the web `AbortSignal`).
 *
 * Each input is planned by [planSearch] (the web `enabled` guard):
 *  - an enabled query streams cache-then-network through the injected [SearchRepository] (S7) — the
 *    cached [SearchResponse] first for an instant cold start, then the refreshed one;
 *  - a disabled / too-short query is a [SearchRequestPlan.Skip]: the holder emits a settled empty
 *    result WITHOUT a network request, reproducing the web hook's documented "empty hits array
 *    (without making a request)" branch. It is a [Resource.Success] (not [Resource.Loading]) so the
 *    UI shows no spinner for a 1-character query, mirroring the web `enabled: false` (`isLoading`
 *    stays false).
 *
 * The web hook's `(prev) => prev` keep-previous option (keep the previous query's hits visible while
 * the next resolves) is a render-layer smoothing concern and is NOT reproduced here, consistent with
 * the sibling `FeedbackStore` (whose web hook uses `keepPreviousData`): the cache-then-network layer
 * already carries the same query's cached value as [Resource.cached], and a UI may retain the last
 * non-empty response across queries if it chooses. The web hook is read-only, so this holder exposes
 * no mutations. It makes no network calls itself; it mirrors the web hook's single-threaded usage and
 * is not internally synchronised — create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the read is routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SearchStore(
    private val repo: SearchRepository,
    private val scope: CoroutineScope,
    initialInput: SearchInput = SearchInput(""),
) {
    private val mutableInput = MutableStateFlow(initialInput)

    /** The current input (query + options) being resolved. Updated via [setQuery]/[setOptions]/[setInput]. */
    public val input: StateFlow<SearchInput> = mutableInput.asStateFlow()

    /**
     * The shared cache-then-network search feed. Cold until first collected; re-plans and re-collects
     * on every [input] change, cancelling the prior read. A disabled / too-short query settles to an
     * empty [Resource.Success] with no request.
     */
    public val results: StateFlow<Resource<SearchResponse>> =
        mutableInput
            .flatMapLatest { inp -> resolve(inp) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )

    /** Sets the raw query, leaving the options unchanged (the web `setQuery` on the hook's first arg). */
    public fun setQuery(query: String) {
        mutableInput.update { it.copy(query = query) }
    }

    /** Replaces the search options (types/limit/disabled), leaving the query unchanged. */
    public fun setOptions(options: SearchOptions) {
        mutableInput.update { it.copy(options = options) }
    }

    /** Replaces the whole input (query + options) atomically. */
    public fun setInput(next: SearchInput) {
        mutableInput.value = next
    }

    private fun resolve(inp: SearchInput): Flow<Resource<SearchResponse>> =
        when (val plan = planSearch(inp)) {
            is SearchRequestPlan.Skip -> flowOf(skipResult(inp))
            is SearchRequestPlan.Fetch -> repo.globalSearch(plan.query, plan.types, plan.limit)
        }

    private companion object {
        // Keep the feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        // The disabled/too-short settle and the cold-start value: empty hits, not loading, no request —
        // the web `enabled: false` ⇒ empty `data` branch. fetchedAt is 0 because no fetch occurred.
        fun skipResult(inp: SearchInput): Resource<SearchResponse> =
            Resource.Success(
                data = SearchResponse(hits = emptyList(), query = inp.query.trim()),
                fetchedAt = 0L,
                stale = false,
            )

        val INITIAL: Resource<SearchResponse> = skipResult(SearchInput(""))
    }
}
