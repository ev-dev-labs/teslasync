package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchResponse
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for unified entity search — the cross-platform analogue of the web `useSearch`
 * hook domain (web/src/api/hooks/useSearch.ts). Every native search surface (Android/Apple via KMP,
 * Windows via the C# port) reaches the backend exclusively through this interface, so a single fake
 * stands in for the whole domain in the S8 state-holder tests.
 *
 * The single read ([globalSearch]) streams a cache-then-network [Resource] (ADR-013): the cached
 * response first for an instant cold start, then the refreshed response. The domain has no mutations
 * — the web hook is read-only — so there is no invalidation surface here.
 *
 * The too-short-query / disabled gating (the web hook's `enabled` guard) is NOT applied here: it is
 * the holder's planning decision (`planSearch`), so the port only ever sees an already-enabled query.
 * Payloads (titles, urls, scores, timestamps) are not display-unit-bearing, so they round-trip
 * verbatim with no SI conversion; display formatting is the render boundary's job (S5).
 */
public interface SearchRepository {
    /**
     * `GET /search?q=` — the unified search for [query], optionally restricted to [types] and capped
     * per-type by [limit] (web `useGlobalSearch`'s `queryFn`). The query map is built by [searchQuery]
     * and the cache key by [searchCacheKey] (the web `searchKeys.global` tuple). Always resolves to a
     * [SearchResponse] whose `hits` is an array.
     */
    public fun globalSearch(
        query: String,
        types: List<SearchHitType>,
        limit: Int?,
    ): Flow<Resource<SearchResponse>>
}

/**
 * Builds the `/search` query map with the web hook's semantics (web/src/api/hooks/useSearch.ts
 * `queryFn`): `q` is always sent (the trimmed query); `types` is sent only when non-empty, joined by
 * `,` exactly as the web `options.types.join(',')`; `limit` is sent only when `> 0`. Keys are
 * snake_case-free (`q`, `types`, `limit`), matching the Go handler. Locked by the repository contract
 * test shared with the C# port.
 */
public fun searchQuery(
    query: String,
    types: List<SearchHitType>,
    limit: Int?,
): Map<String, String> =
    buildMap {
        put("q", query)
        if (types.isNotEmpty()) put("types", types.joinToString(",") { it.wire })
        if (limit != null && limit > 0) put("limit", limit.toString())
    }

/**
 * Builds the stable cache key for a search, mirroring the web `searchKeys.global` tuple
 * `['search', 'global', query, types?.join(',') ?? '', limit ?? null]`: the trimmed query, the
 * comma-joined type filter (`''` when none, exactly as the web `?? ''`), and the limit (`'null'` when
 * absent, exactly as the web `?? null`) are flattened into one key with a NUL separator so two reads
 * collide in the cache exactly when their web query keys do. Locked by the repository contract test
 * shared with the C# port.
 */
public fun searchCacheKey(
    query: String,
    types: List<SearchHitType>,
    limit: Int?,
): String {
    val typesPart = types.joinToString(",") { it.wire }
    val limitPart = limit?.toString() ?: "null"
    return "$query\u0000$typesPart\u0000$limitPart"
}
