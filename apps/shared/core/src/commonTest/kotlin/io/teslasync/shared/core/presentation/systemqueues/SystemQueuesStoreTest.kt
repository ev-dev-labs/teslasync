package io.teslasync.shared.core.presentation.systemqueues

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SystemQueuesRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [SystemQueuesStore] folds the S7 [SystemQueuesRepository] into shared, refreshable
 * feeds and honours the web `useQueueJobs` `enabled` gate — using a fake repository, so no network or
 * cache is involved. Mirrors the web `useSystemQueues` hook domain: two reads (`useQueueStatus`,
 * `useQueueJobs`), no mutations.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SystemQueuesStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success, stamping the collection count into the payload so a refresh is assertable.
     */
    private class FakeSystemQueuesRepository : SystemQueuesRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val jobsLimits: MutableList<Int> = mutableListOf()

        private fun bump(key: String): Int {
            val n = (collections[key] ?: 0) + 1
            collections[key] = n
            return n
        }

        override fun queueStatus(): Flow<Resource<QueueStatusResponse>> =
            flow {
                val n = bump("status")
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data = QueueStatusResponse(generatedAt = "gen-$n", workers = emptyList()),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override fun queueJobs(
            worker: String,
            limit: Int,
        ): Flow<Resource<QueueJobsResponse>> =
            flow {
                val n = bump("jobs:$worker")
                jobsLimits += limit
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data = QueueJobsResponse(worker = worker, jobs = emptyList()),
                        fetchedAt = n.toLong(),
                        stale = false,
                    ),
                )
            }
    }

    @Test
    fun queueStatusEmitsCacheThenNetwork() =
        runTest {
            val store = SystemQueuesStore(FakeSystemQueuesRepository(), backgroundScope)
            val seen = mutableListOf<Resource<*>>()
            backgroundScope.launch { store.queueStatus().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(seen.last() is Resource.Success, "terminal emission is the network success")
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = SystemQueuesStore(FakeSystemQueuesRepository(), backgroundScope)
            assertSame(store.queueStatus(), store.queueStatus(), "status folds into one shared feed")
            // Distinct workers are distinct feeds; the same worker folds into one.
            assertSame(store.queueJobs("export"), store.queueJobs("export"))
            assertTrue(store.queueJobs("export") !== store.queueJobs("notification"))
        }

    @Test
    fun observersOfTheStatusFeedFoldIntoASingleCollection() =
        runTest {
            val repo = FakeSystemQueuesRepository()
            val store = SystemQueuesStore(repo, backgroundScope)
            backgroundScope.launch { store.queueStatus().collect {} }
            backgroundScope.launch { store.queueStatus().collect {} }
            runCurrent()

            assertEquals(1, repo.collections["status"], "two observers ⇒ one upstream collection")
        }

    @Test
    fun jobsGateReturnsStableDisabledFeedForBlankOrDisabled() =
        runTest {
            val repo = FakeSystemQueuesRepository()
            val store = SystemQueuesStore(repo, backgroundScope)

            val disabledBlank = store.queueJobs("")
            val disabledWhitespace = store.queueJobs("   ")
            val disabledFlag = store.queueJobs("export", enabled = false)

            // All collapse to the same stable, non-fetching Loading instance.
            assertSame(disabledBlank, disabledWhitespace)
            assertSame(disabledWhitespace, disabledFlag)
            backgroundScope.launch { disabledBlank.collect {} }
            runCurrent()
            assertTrue(disabledBlank.value is Resource.Loading)
            // The repository is never touched for a disabled jobs query.
            assertNull(repo.collections["jobs:export"])
            assertNull(repo.collections["jobs:"])
        }

    @Test
    fun enabledJobsFetchesForTheWorkerWithItsLimit() =
        runTest {
            val repo = FakeSystemQueuesRepository()
            val store = SystemQueuesStore(repo, backgroundScope)
            backgroundScope.launch { store.queueJobs("export", limit = 100).collect {} }
            runCurrent()

            assertEquals(1, repo.collections["jobs:export"])
            assertEquals(listOf(100), repo.jobsLimits)
        }

    @Test
    fun jobsDefaultLimitIs25() =
        runTest {
            val repo = FakeSystemQueuesRepository()
            val store = SystemQueuesStore(repo, backgroundScope)
            backgroundScope.launch { store.queueJobs("export").collect {} }
            runCurrent()

            assertEquals(listOf(25), repo.jobsLimits, "default limit is QUEUE_JOBS_DEFAULT_LIMIT (25)")
        }

    @Test
    fun refreshReFetchesTheObservedStatusFeed() =
        runTest {
            val repo = FakeSystemQueuesRepository()
            val store = SystemQueuesStore(repo, backgroundScope)
            backgroundScope.launch { store.queueStatus().collect {} }
            runCurrent()
            assertEquals(1, repo.collections["status"])

            store.refreshQueueStatus()
            runCurrent()

            assertEquals(2, repo.collections["status"], "the status feed was refreshed")
        }

    @Test
    fun refreshReFetchesOnlyTheTargetWorkerJobsFeed() =
        runTest {
            val repo = FakeSystemQueuesRepository()
            val store = SystemQueuesStore(repo, backgroundScope)
            backgroundScope.launch { store.queueJobs("export").collect {} }
            backgroundScope.launch { store.queueJobs("notification").collect {} }
            runCurrent()
            assertEquals(1, repo.collections["jobs:export"])
            assertEquals(1, repo.collections["jobs:notification"])

            store.refreshQueueJobs("export")
            runCurrent()

            assertEquals(2, repo.collections["jobs:export"], "the targeted worker feed refreshed")
            assertEquals(1, repo.collections["jobs:notification"], "the other worker feed was untouched")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeSystemQueuesRepository()
            val store = SystemQueuesStore(repo, backgroundScope)

            store.refreshQueueStatus()
            store.refreshQueueJobs("export")
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no observer ⇒ no upstream restart")
        }
}
