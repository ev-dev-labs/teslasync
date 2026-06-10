package io.teslasync.shared.core.presentation.pinned

import io.teslasync.shared.core.data.repo.PinnedRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.pinnedCacheKey
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
 * Verifies the S8 [PinnedStore] folds the S7 [PinnedRepository] into shared, refreshable feeds and
 * routes each mutation to the right repository call + the web-faithful invalidate granularity
 * (toggle ⇒ refresh ALL feeds; reorder ⇒ refresh ONLY the no-context feed of that type) — using a
 * fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PinnedStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per `(type, context)` key (so a refresh is
     * observable) and emits Loading→Success with a single deterministic row; the unpin-lookup
     * surfaces ([peeked]/[fetchResult]) and each mutation result are configurable, and every
     * mutation records its argument.
     */
    private class FakePinnedRepository : PinnedRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val created: MutableList<Triple<PinnedItemType, String, String?>> = mutableListOf()
        val deleted: MutableList<Long> = mutableListOf()
        val reordered: MutableList<Pair<Long, Int>> = mutableListOf()
        val peeked: MutableMap<String, List<PinnedItem>?> = mutableMapOf()
        var fetchResult: (PinnedItemType, String?) -> Result<List<PinnedItem>> = { _, _ -> Result.success(emptyList()) }
        var createResult: Result<PinnedItem> = Result.success(item(1))
        var deleteResult: Result<Unit> = Result.success(Unit)
        var reorderResult: Result<PinnedItem> = Result.success(item(1))

        override fun pinned(
            type: PinnedItemType,
            context: String?,
        ): Flow<Resource<List<PinnedItem>>> =
            flow {
                val key = pinnedCacheKey(type, context)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(item(n.toLong(), itemId = "item-$n")), fetchedAt = 1L, stale = false))
            }

        override suspend fun peekPinned(
            type: PinnedItemType,
            context: String?,
        ): List<PinnedItem>? = peeked[pinnedCacheKey(type, context)]

        override suspend fun fetchPinned(
            type: PinnedItemType,
            context: String?,
        ): Result<List<PinnedItem>> = fetchResult(type, context)

        override suspend fun createPin(
            type: PinnedItemType,
            itemId: String,
            context: String?,
        ): Result<PinnedItem> {
            created += Triple(type, itemId, context)
            return createResult
        }

        override suspend fun deletePin(id: Long): Result<Unit> {
            deleted += id
            return deleteResult
        }

        override suspend fun reorderPin(
            id: Long,
            position: Int,
        ): Result<PinnedItem> {
            reordered += (id to position)
            return reorderResult
        }

        companion object {
            fun item(
                id: Long,
                itemId: String = "item-$id",
                type: PinnedItemType = PinnedItemType.Widget,
                context: String? = null,
            ): PinnedItem =
                PinnedItem(
                    id = id,
                    itemType = type,
                    itemId = itemId,
                    position = 0,
                    pinnedAt = "2026-01-01T00:00:00Z",
                    context = context,
                )
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = PinnedStore(FakePinnedRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<PinnedItem>>>()
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("item-1", last.data.first().itemId)
        }

    @Test
    fun sameBucketSharesUpstreamAndDistinctBucketsAreDistinctFeeds() =
        runTest {
            val store = PinnedStore(FakePinnedRepository(), backgroundScope)
            assertSame(store.pinned(PinnedItemType.Widget), store.pinned(PinnedItemType.Widget))
            // A different context is a DIFFERENT feed (web key tuple `['pinned', type, context]`).
            val noContext = store.pinned(PinnedItemType.Widget)
            val glance = store.pinned(PinnedItemType.Widget, "glance")
            assertTrue(noContext !== glance)
            // A different type is also a different feed.
            assertTrue(store.pinned(PinnedItemType.Vehicle) !== noContext)
        }

    @Test
    fun pinDelegatesPostAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakePinnedRepository()
            val store = PinnedStore(repo, backgroundScope)
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect {} }
            backgroundScope.launch { store.pinned(PinnedItemType.Vehicle).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Vehicle, null)])

            val result = store.togglePin(PinnedItemType.Widget, itemId = "battery", pin = true)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple(PinnedItemType.Widget, "battery", null as String?)), repo.created)
            // invalidate `all`: BOTH observed feeds re-fetch.
            assertEquals(2, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
            assertEquals(2, repo.collections[pinnedCacheKey(PinnedItemType.Vehicle, null)])
        }

    @Test
    fun unpinResolvesFromCacheDeletesThenRefreshesAll() =
        runTest {
            val repo = FakePinnedRepository()
            repo.peeked[pinnedCacheKey(PinnedItemType.Widget, null)] =
                listOf(FakePinnedRepository.item(id = 42, itemId = "battery"))
            val store = PinnedStore(repo, backgroundScope)
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])

            val result = store.togglePin(PinnedItemType.Widget, itemId = "battery", pin = false)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(42L), repo.deleted, "deletes the cache-resolved row id")
            // No fresh fetch needed — the cache hit short-circuits the fallback.
            assertEquals(2, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
        }

    @Test
    fun unpinFallsBackToFetchWhenCacheMisses() =
        runTest {
            val repo = FakePinnedRepository()
            // Cold cache (no peeked entry) ⇒ the fresh-fetch fallback resolves the row id.
            repo.fetchResult = { _, _ -> Result.success(listOf(FakePinnedRepository.item(id = 7, itemId = "rear"))) }
            val store = PinnedStore(repo, backgroundScope)

            val result = store.togglePin(PinnedItemType.Widget, itemId = "rear", pin = false)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(7L), repo.deleted)
        }

    @Test
    fun unpinNoMatchingRowIsSuccessfulNoOpThatStillRefreshes() =
        runTest {
            val repo = FakePinnedRepository()
            // Cache + fetch both empty ⇒ web returns null and STILL runs onSuccess (refresh).
            val store = PinnedStore(repo, backgroundScope)
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])

            val result = store.togglePin(PinnedItemType.Widget, itemId = "ghost", pin = false)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(null, result.getOrThrow())
            assertTrue(repo.deleted.isEmpty(), "no row resolved ⇒ no DELETE")
            assertEquals(2, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)], "no-op unpin still refreshes")
        }

    @Test
    fun unpinPropagatesFetchFailureWithoutRefreshing() =
        runTest {
            val repo = FakePinnedRepository()
            repo.fetchResult = { _, _ -> Result.failure(IllegalStateException("offline")) }
            val store = PinnedStore(repo, backgroundScope)
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])

            val result = store.togglePin(PinnedItemType.Widget, itemId = "rear", pin = false)
            runCurrent()

            assertTrue(result.isFailure)
            assertTrue(repo.deleted.isEmpty())
            // onError ⇒ no invalidation: the observed feed is NOT re-fetched.
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
        }

    @Test
    fun failedCreateDoesNotRefresh() =
        runTest {
            val repo = FakePinnedRepository()
            repo.createResult = Result.failure(IllegalStateException("409"))
            val store = PinnedStore(repo, backgroundScope)
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])

            val result = store.togglePin(PinnedItemType.Widget, itemId = "battery", pin = true)
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
        }

    @Test
    fun reorderRefreshesOnlyNoContextFeedOfThatType() =
        runTest {
            val repo = FakePinnedRepository()
            val store = PinnedStore(repo, backgroundScope)
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect {} }
            backgroundScope.launch { store.pinned(PinnedItemType.Widget, "glance").collect {} }
            backgroundScope.launch { store.pinned(PinnedItemType.Vehicle).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, "glance")])
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Vehicle, null)])

            val result = store.reorderPin(PinnedItemType.Widget, id = 5, position = 2)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L to 2), repo.reordered)
            // Web invalidates `pinnedKeys.list(type)` = `['pinned', type, null]` ⇒ ONLY the
            // no-context Widget feed re-fetches; the contexted Widget feed and the Vehicle feed
            // are untouched.
            assertEquals(2, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, "glance")])
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Vehicle, null)])
        }

    @Test
    fun reorderFailureDoesNotRefresh() =
        runTest {
            val repo = FakePinnedRepository()
            repo.reorderResult = Result.failure(IllegalStateException("404"))
            val store = PinnedStore(repo, backgroundScope)
            backgroundScope.launch { store.pinned(PinnedItemType.Widget).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])

            val result = store.reorderPin(PinnedItemType.Widget, id = 5, position = 2)
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.collections[pinnedCacheKey(PinnedItemType.Widget, null)])
        }

    @Test
    fun refreshAllIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakePinnedRepository()
            val store = PinnedStore(repo, backgroundScope)

            val result = store.togglePin(PinnedItemType.Widget, itemId = "battery", pin = true)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.created.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
