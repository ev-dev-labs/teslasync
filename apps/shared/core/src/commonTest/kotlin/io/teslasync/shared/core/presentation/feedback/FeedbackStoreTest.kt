package io.teslasync.shared.core.presentation.feedback

import io.teslasync.shared.core.data.repo.FeedbackRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.feedbackCacheKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [FeedbackStore] folds the S7 [FeedbackRepository] into shared, refreshable
 * feeds and routes each mutation to the right repository call with the web-faithful refresh
 * behaviour — submit refreshes nothing, update invalidates-all — using a fake repository, so no
 * network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FeedbackStoreTest {
    /**
     * Fake S7 port: the read re-counts its collections per `params` key (so a refresh is
     * observable) and emits Loading→Success with a deterministic response whose [FeedbackListResponse.total]
     * advances per collection; every mutation records its argument and succeeds.
     */
    private class FakeFeedbackRepository : FeedbackRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val submitted: MutableList<FeedbackSubmitInput> = mutableListOf()
        val updated: MutableList<FeedbackUpdateInput> = mutableListOf()

        override fun feedbackList(params: FeedbackListParams): Flow<Resource<FeedbackListResponse>> =
            flow {
                val key = feedbackCacheKey(params)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data = FeedbackListResponse(items = listOf(entry(n.toLong())), total = n.toLong()),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override suspend fun submitFeedback(input: FeedbackSubmitInput): Result<FeedbackEntry> {
            submitted += input
            return Result.success(entry(1))
        }

        override suspend fun updateFeedback(input: FeedbackUpdateInput): Result<FeedbackEntry> {
            updated += input
            return Result.success(entry(input.id))
        }

        companion object {
            fun entry(id: Long): FeedbackEntry =
                FeedbackEntry(
                    id = id,
                    createdAt = "2026-01-01T00:00:00Z",
                    category = "bug",
                    title = "entry-$id",
                    body = "body",
                    status = "new",
                )
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = FeedbackStore(FakeFeedbackRepository(), backgroundScope)
            val seen = mutableListOf<Resource<FeedbackListResponse>>()
            backgroundScope.launch { store.feedbackList().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(
                "entry-1",
                last.data.items
                    .first()
                    .title,
            )
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = FeedbackStore(FakeFeedbackRepository(), backgroundScope)
            assertSame(store.feedbackList(), store.feedbackList())
            val byStatus = store.feedbackList(FeedbackListParams(status = "new"))
            val byCategory = store.feedbackList(FeedbackListParams(category = "bug"))
            assertTrue(byStatus !== byCategory)
        }

    @Test
    fun submitDelegatesAndDoesNotRefreshAnyFeed() =
        runTest {
            val repo = FakeFeedbackRepository()
            val store = FeedbackStore(repo, backgroundScope)
            val params = FeedbackListParams(status = "new")
            backgroundScope.launch { store.feedbackList(params).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[feedbackCacheKey(params)])

            val input = FeedbackSubmitInput(category = "bug", title = "Broken", body = "Something went wrong")
            val result = store.submitFeedback(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.submitted)
            // Web `useSubmitFeedback` invalidates nothing: the observed feed is NOT re-fetched.
            assertEquals(1, repo.collections[feedbackCacheKey(params)])
        }

    @Test
    fun updateDelegatesAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakeFeedbackRepository()
            val store = FeedbackStore(repo, backgroundScope)
            val a = FeedbackListParams(status = "new")
            val b = FeedbackListParams(category = "bug")
            backgroundScope.launch { store.feedbackList(a).collect {} }
            backgroundScope.launch { store.feedbackList(b).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[feedbackCacheKey(a)])
            assertEquals(1, repo.collections[feedbackCacheKey(b)])

            val result = store.updateFeedback(FeedbackUpdateInput(id = 5, status = "closed"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L), repo.updated.map { it.id })
            // invalidate `all`: BOTH observed feeds re-fetch.
            assertEquals(2, repo.collections[feedbackCacheKey(a)])
            assertEquals(2, repo.collections[feedbackCacheKey(b)])
        }

    @Test
    fun observedFeedReprojectsRefreshedUpstreamAfterUpdate() =
        runTest {
            val repo = FakeFeedbackRepository()
            val store = FeedbackStore(repo, backgroundScope)
            val params = FeedbackListParams(status = "new")
            val seen = mutableListOf<Resource<FeedbackListResponse>>()
            backgroundScope.launch { store.feedbackList(params).collect { seen += it } }
            runCurrent()
            assertEquals(1L, (seen.last() as Resource.Success).data.total)

            store.updateFeedback(FeedbackUpdateInput(id = 9, forwardToGithub = true))
            runCurrent()

            // The feed re-collected the refreshed upstream (total advanced to 2).
            assertEquals(2L, (seen.last() as Resource.Success).data.total)
        }

    @Test
    fun refreshAllIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeFeedbackRepository()
            val store = FeedbackStore(repo, backgroundScope)

            val result = store.updateFeedback(FeedbackUpdateInput(id = 1, status = "triaged"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.updated.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
