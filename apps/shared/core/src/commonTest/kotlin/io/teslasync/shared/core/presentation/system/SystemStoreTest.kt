package io.teslasync.shared.core.presentation.system

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SYSTEM_RATE_LIMITS_KEY
import io.teslasync.shared.core.data.repo.SystemRepository
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
 * Verifies the S8 [SystemStore] folds the S7 [SystemRepository] into a shared, refreshable feed —
 * using a fake repository, so no network or cache is involved. Mirrors the web `useSystem` hook
 * domain: one fixed read (`useRateLimitStatus`), no mutations.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SystemStoreTest {
    /**
     * Fake S7 port: counts collections of the rate-limit feed (so a refresh is observable) and
     * emits Loading→Success for the read, stamping the collection count into the scope id so a
     * refresh is assertable end-to-end.
     */
    private class FakeSystemRepository : SystemRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        private fun bump(key: String): Int {
            val n = (collections[key] ?: 0) + 1
            collections[key] = n
            return n
        }

        override fun rateLimitStatus(): Flow<Resource<RateLimitStatusResponse>> =
            flow {
                val n = bump(SYSTEM_RATE_LIMITS_KEY)
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            RateLimitStatusResponse(
                                generatedAt = "2026-01-01T00:00:00Z",
                                scopes = listOf(ScopeBudget(id = "scope-$n", name = "Scope", severity = "ok")),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }
    }

    @Test
    fun rateLimitStatusEmitsCacheThenNetwork() =
        runTest {
            val store = SystemStore(FakeSystemRepository(), backgroundScope)
            val seen = mutableListOf<Resource<*>>()
            backgroundScope.launch { store.rateLimitStatus().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(seen.last() is Resource.Success, "terminal emission is the network success")
        }

    @Test
    fun theFixedReadFoldsIntoOneSharedFeed() =
        runTest {
            val store = SystemStore(FakeSystemRepository(), backgroundScope)
            assertSame(store.rateLimitStatus(), store.rateLimitStatus(), "a fixed read folds into one shared feed")
        }

    @Test
    fun observersOfTheFeedFoldIntoASingleCollection() =
        runTest {
            val repo = FakeSystemRepository()
            val store = SystemStore(repo, backgroundScope)
            backgroundScope.launch { store.rateLimitStatus().collect {} }
            backgroundScope.launch { store.rateLimitStatus().collect {} }
            runCurrent()

            assertEquals(1, repo.collections[SYSTEM_RATE_LIMITS_KEY], "two observers ⇒ one upstream collection")
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeSystemRepository()
            val store = SystemStore(repo, backgroundScope)
            backgroundScope.launch { store.rateLimitStatus().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SYSTEM_RATE_LIMITS_KEY])

            store.refreshRateLimitStatus()
            runCurrent()

            assertEquals(2, repo.collections[SYSTEM_RATE_LIMITS_KEY], "the rate-limit feed was refreshed")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeSystemRepository()
            val store = SystemStore(repo, backgroundScope)

            store.refreshRateLimitStatus()
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no observer ⇒ no upstream restart")
        }
}
