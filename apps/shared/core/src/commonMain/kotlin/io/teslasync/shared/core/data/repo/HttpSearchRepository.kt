package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * HTTP-backed [SearchRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013).
 * Each distinct (query, types, limit) read shares the single [CacheDomain.Search] partition, keyed by
 * the web TanStack scope tuple via [searchCacheKey], so each query is cached independently and logout
 * clears everything.
 *
 * The web `useGlobalSearch` hook reads with `STALE_TIMES.FAST` (30s); [CacheDomain.Search] carries the
 * same 30-second window, so a cached response flags stale on the same threshold the web flips its
 * freshness on. The domain has no mutations (the web hook is read-only), so there is no eviction
 * surface here.
 */
public class HttpSearchRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<SearchResponse>(
        store,
        clock,
        json,
        SearchResponse.serializer(),
    ),
    SearchRepository {
    override val domain: CacheDomain = CacheDomain.Search

    override fun globalSearch(
        query: String,
        types: List<SearchHitType>,
        limit: Int?,
    ): Flow<Resource<SearchResponse>> =
        observe(searchCacheKey(query, types, limit)) {
            api.request<SearchResponse>(path = SEARCH_PATH, query = searchQuery(query, types, limit))
        }

    private companion object {
        const val SEARCH_PATH = "/search"
    }
}
