package io.teslasync.shared.core.presentation.push

import io.teslasync.shared.core.data.repo.PushRepository
import io.teslasync.shared.core.data.repo.Resource
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
 * Verifies the S8 [PushStore] folds the S7 [PushRepository] into shared, refreshable feeds and
 * routes each mutation to the right repository call + the web-faithful invalidate granularity
 * (subscribe/unsubscribe ⇒ refresh ONLY the subscription feed; the public-key feed is never
 * invalidated) — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PushStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success; the mutation results are configurable and each mutation records its argument.
     */
    private class FakePushRepository : PushRepository {
        var publicKeyCollections = 0
        var subscriptionsCollections = 0
        val subscribed: MutableList<PushSubscribeBody> = mutableListOf()
        val unsubscribed: MutableList<String> = mutableListOf()
        var subscribeResult: Result<PushSubscription> = Result.success(row(1))
        var unsubscribeResult: Result<Unit> = Result.success(Unit)

        override fun publicKey(): Flow<Resource<PushPublicKey>> =
            flow {
                publicKeyCollections += 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(PushPublicKey(key = "BFkey"), fetchedAt = 1L, stale = false))
            }

        override fun subscriptions(): Flow<Resource<List<PushSubscription>>> =
            flow {
                val n = ++subscriptionsCollections
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(listOf(row(n.toLong())), fetchedAt = 1L, stale = false))
            }

        override suspend fun subscribe(body: PushSubscribeBody): Result<PushSubscription> {
            subscribed += body
            return subscribeResult
        }

        override suspend fun unsubscribe(endpoint: String): Result<Unit> {
            unsubscribed += endpoint
            return unsubscribeResult
        }

        companion object {
            fun row(id: Long): PushSubscription =
                PushSubscription(
                    id = id,
                    endpoint = "https://push.example.com/$id",
                    p256dh = "pk",
                    auth = "sec",
                    createdAt = "2026-01-01T00:00:00Z",
                )

            fun body(endpoint: String = "https://push.example.com/abc"): PushSubscribeBody =
                PushSubscribeBody(endpoint = endpoint, keys = PushSubscribeKeys(p256dh = "pk", auth = "sec"))
        }
    }

    // ---- Reads --------------------------------------------------------------------

    @Test
    fun publicKeyReadEmitsCacheThenNetwork() =
        runTest {
            val store = PushStore(FakePushRepository(), backgroundScope)
            val seen = mutableListOf<Resource<PushPublicKey>>()
            backgroundScope.launch { store.publicKey().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading")
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals("BFkey", last.data.key)
        }

    @Test
    fun subscriptionsReadEmitsCacheThenNetwork() =
        runTest {
            val store = PushStore(FakePushRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<PushSubscription>>>()
            backgroundScope.launch { store.subscriptions().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals(1, last.data.size)
        }

    @Test
    fun feedsAreSharedAcrossObservers() =
        runTest {
            val store = PushStore(FakePushRepository(), backgroundScope)
            assertSame(store.publicKey(), store.publicKey())
            assertSame(store.subscriptions(), store.subscriptions())
        }

    // ---- Mutations ----------------------------------------------------------------

    @Test
    fun subscribeDelegatesPostAndRefreshesOnlySubscriptionFeed() =
        runTest {
            val repo = FakePushRepository()
            val store = PushStore(repo, backgroundScope)
            backgroundScope.launch { store.publicKey().collect {} }
            backgroundScope.launch { store.subscriptions().collect {} }
            runCurrent()
            assertEquals(1, repo.publicKeyCollections)
            assertEquals(1, repo.subscriptionsCollections)

            val result = store.subscribe(FakePushRepository.body())
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.subscribed.size)
            assertEquals("https://push.example.com/abc", repo.subscribed.first().endpoint)
            // Web invalidates ONLY pushKeys.list: subscriptions re-fetch, public key untouched.
            assertEquals(2, repo.subscriptionsCollections)
            assertEquals(1, repo.publicKeyCollections)
        }

    @Test
    fun unsubscribeDelegatesDeleteAndRefreshesOnlySubscriptionFeed() =
        runTest {
            val repo = FakePushRepository()
            val store = PushStore(repo, backgroundScope)
            backgroundScope.launch { store.publicKey().collect {} }
            backgroundScope.launch { store.subscriptions().collect {} }
            runCurrent()
            assertEquals(1, repo.subscriptionsCollections)

            val result = store.unsubscribe("https://push.example.com/abc")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("https://push.example.com/abc"), repo.unsubscribed)
            assertEquals(2, repo.subscriptionsCollections)
            assertEquals(1, repo.publicKeyCollections)
        }

    @Test
    fun failedSubscribeDoesNotRefresh() =
        runTest {
            val repo = FakePushRepository()
            repo.subscribeResult = Result.failure(IllegalStateException("500"))
            val store = PushStore(repo, backgroundScope)
            backgroundScope.launch { store.subscriptions().collect {} }
            runCurrent()
            assertEquals(1, repo.subscriptionsCollections)

            val result = store.subscribe(FakePushRepository.body())
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.subscriptionsCollections, "onError ⇒ no invalidation")
        }

    @Test
    fun failedUnsubscribeDoesNotRefresh() =
        runTest {
            val repo = FakePushRepository()
            repo.unsubscribeResult = Result.failure(IllegalStateException("404"))
            val store = PushStore(repo, backgroundScope)
            backgroundScope.launch { store.subscriptions().collect {} }
            runCurrent()
            assertEquals(1, repo.subscriptionsCollections)

            val result = store.unsubscribe("https://push.example.com/abc")
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.subscriptionsCollections)
        }

    @Test
    fun refreshIsNoOpWhenSubscriptionsNotObserved() =
        runTest {
            val repo = FakePushRepository()
            val store = PushStore(repo, backgroundScope)

            val result = store.subscribe(FakePushRepository.body())
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.subscribed.size)
            assertEquals(0, repo.subscriptionsCollections, "no feed observed ⇒ no needless restart")
        }
}
