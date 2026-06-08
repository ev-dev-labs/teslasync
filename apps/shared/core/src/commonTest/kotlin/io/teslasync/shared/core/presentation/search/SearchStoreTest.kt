package io.teslasync.shared.core.presentation.search

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SearchRepository
import io.teslasync.shared.core.data.repo.searchCacheKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Verifies the S8 [SearchStore] folds its single dynamic [SearchInput] into one shared cache-then-
 * network feed, planning each input through [planSearch] (the web `enabled` guard): an enabled query
 * delegates to the S7 [SearchRepository] with the TRIMMED query + filters and emits cache→network; a
 * disabled / too-short query settles to an empty [Resource.Success] WITHOUT touching the repository.
 * Uses a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchStoreTest {
    /** Fake S7 port: records every call's (query, types, limit) and emits Loading→Success with one hit. */
    private class FakeSearchRepository : SearchRepository {
        val calls: MutableList<Triple<String, List<SearchHitType>, Int?>> = mutableListOf()

        override fun globalSearch(
            query: String,
            types: List<SearchHitType>,
            limit: Int?,
        ): Flow<Resource<SearchResponse>> =
            flow {
                calls += Triple(query, types, limit)
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            SearchResponse(
                                hits = listOf(hit(query)),
                                query = query,
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        companion object {
            fun hit(title: String): SearchHit =
                SearchHit(type = SearchHitType.Vehicle, id = 1, title = title, url = "/vehicles/1", score = 1.0)
        }
    }

    // ---- Enabled read -------------------------------------------------------------

    @Test
    fun enabledQueryEmitsCacheThenNetworkAndDelegatesTrimmed() =
        runTest {
            val repo = FakeSearchRepository()
            val store = SearchStore(repo, backgroundScope)
            val seen = mutableListOf<Resource<SearchResponse>>()
            backgroundScope.launch { store.results.collect { seen += it } }
            runCurrent()

            store.setQuery("  model 3  ")
            runCurrent()

            // The web `enabled` guard fetches with the trimmed query.
            assertEquals(listOf(Triple("model 3", emptyList<SearchHitType>(), null as Int?)), repo.calls)
            // Note: the cache→network Loading→Success sequence is asserted at the cold-flow level in
            // SearchRepositoryContractTest; the StateFlow here conflates the transient Loading, so we
            // assert only the settled terminal Success the UI binds to.
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            val response = last.data
            assertEquals("model 3", response.query)
            assertEquals("model 3", response.hits.first().title)
        }

    @Test
    fun typesAndLimitArePassedThrough() =
        runTest {
            val repo = FakeSearchRepository()
            val store = SearchStore(repo, backgroundScope)
            backgroundScope.launch { store.results.collect {} }
            runCurrent()

            store.setInput(
                SearchInput(
                    query = "mod",
                    options = SearchOptions(types = listOf(SearchHitType.Vehicle, SearchHitType.Drive), limit = 5),
                ),
            )
            runCurrent()

            assertEquals(
                listOf(Triple("mod", listOf(SearchHitType.Vehicle, SearchHitType.Drive), 5 as Int?)),
                repo.calls,
            )
        }

    // ---- Skip (gated) -------------------------------------------------------------

    @Test
    fun tooShortQuerySettlesEmptyWithoutHittingRepo() =
        runTest {
            val repo = FakeSearchRepository()
            val store = SearchStore(repo, backgroundScope)
            val seen = mutableListOf<Resource<SearchResponse>>()
            backgroundScope.launch { store.results.collect { seen += it } }
            runCurrent()

            store.setQuery("m")
            runCurrent()

            assertTrue(repo.calls.isEmpty(), "a 1-char query is below SEARCH_MIN_QUERY_LENGTH ⇒ no request")
            val last = seen.last()
            assertTrue(last is Resource.Success, "skip settles (no spinner), not Loading")
            assertTrue(last.data.hits.isEmpty(), "skip ⇒ empty hits")
        }

    @Test
    fun disabledQuerySettlesEmptyWithoutHittingRepo() =
        runTest {
            val repo = FakeSearchRepository()
            val store = SearchStore(repo, backgroundScope)
            val seen = mutableListOf<Resource<SearchResponse>>()
            backgroundScope.launch { store.results.collect { seen += it } }
            runCurrent()

            // A long-enough query but explicitly disabled (web `options.disabled`).
            store.setInput(SearchInput(query = "model 3", options = SearchOptions(disabled = true)))
            runCurrent()

            assertTrue(repo.calls.isEmpty(), "disabled ⇒ no request regardless of length")
            assertTrue((seen.last() as Resource.Success).data.hits.isEmpty())
        }

    @Test
    fun reenablingAfterSkipFetches() =
        runTest {
            val repo = FakeSearchRepository()
            val store = SearchStore(repo, backgroundScope)
            backgroundScope.launch { store.results.collect {} }
            runCurrent()

            store.setQuery("m")
            runCurrent()
            assertTrue(repo.calls.isEmpty())

            store.setQuery("mo")
            runCurrent()
            assertEquals(listOf(Triple("mo", emptyList<SearchHitType>(), null as Int?)), repo.calls)
        }

    @Test
    fun coldStartIsSettledEmpty() =
        runTest {
            val repo = FakeSearchRepository()
            val store = SearchStore(repo, backgroundScope)
            val seen = mutableListOf<Resource<SearchResponse>>()
            backgroundScope.launch { store.results.collect { seen += it } }
            runCurrent()

            // Initial empty query ⇒ skip ⇒ empty Success, no request.
            assertTrue(repo.calls.isEmpty())
            assertTrue((seen.last() as Resource.Success).data.hits.isEmpty())
            // The store's cache key for this query is web-faithful (sanity reference to the builder).
            assertEquals("mo\u0000\u0000null", searchCacheKey("mo", emptyList(), null))
        }
}
