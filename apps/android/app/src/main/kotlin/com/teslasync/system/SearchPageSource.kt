// The data port the SearchPage surface binds to (P1/S8), plus its production binding over the shared-core S7
// SearchRepository. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// resolves the single web read (web/src/features/system/pages/SearchPage.tsx): `useGlobalSearch(trimmed, { types,
// limit: 25, disabled: tooShort })`.
//
// The unified search is the shared-core cache-then-network `Resource<SearchResponse>` stream the S7
// [SearchRepository] already exposes (memoized per (query, types, limit) cache key, the web `searchKeys.global`
// tuple). The min-length / disabled gating (the web hook's `enabled` guard) is NOT applied at this port — it is the
// view-model's planning decision via the shared `planSearch`, so the port only ever sees an already-enabled query.
// Narrow seam so the view-model + page depend on an abstraction (the real adapter ↔ a test fake), never on a
// concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.search

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SearchRepository
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchResponse
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the SearchPage surface depends on so it binds to an abstraction (the shared SearchRepository in
 * production, a fake in tests), never to a concrete repository or the network. The unified search is a
 * cache-then-network `Resource` flow (the page's one read). No HTTP touches the view.
 */
interface SearchPageSource {
    /**
     * The cache-then-network `GET /search?q=` feed (web `useGlobalSearch`'s `queryFn`), for an already-enabled
     * [query] (the trimmed query the view-model's `planSearch` decided to fetch), optionally restricted to [types]
     * and capped per-type by [limit]. The cache-then-network freshness flags flow through verbatim.
     */
    fun search(
        query: String,
        types: List<SearchHitType>,
        limit: Int?,
    ): Flow<Resource<SearchResponse>>
}

/**
 * Binds the surface to the shared **S7** [SearchRepository] — the memoized cache-then-network search feed every
 * native search surface shares. The live values flow through unchanged so the view-model renders the full state
 * matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun searchPageSourceOf(searchRepository: SearchRepository): SearchPageSource =
    object : SearchPageSource {
        override fun search(
            query: String,
            types: List<SearchHitType>,
            limit: Int?,
        ): Flow<Resource<SearchResponse>> = searchRepository.globalSearch(query, types, limit)
    }
