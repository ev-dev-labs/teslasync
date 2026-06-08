package io.teslasync.shared.core.presentation.impersonation

import io.teslasync.shared.core.data.repo.ImpersonationRepository
import io.teslasync.shared.core.data.repo.Resource
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
 * Verifies the S8 [ImpersonationStore] folds the S7 [ImpersonationRepository] into shared,
 * refreshable feeds, derives the open/active predicates off the SAME upstream, and routes each
 * mutation to the right repository call + an invalidate-all refresh of BOTH feeds — using a fake
 * repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ImpersonationStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success with a deterministic value; each mutation records its argument and returns the
     * configured [Result].
     */
    private class FakeImpersonationRepository : ImpersonationRepository {
        var statusCollections = 0
        var candidatesCollections = 0
        val started = mutableListOf<ImpersonationStartRequest>()
        var ended = 0

        var statusFactory: (Int) -> ImpersonationStatus = { ImpersonationStatus.Inactive }
        var candidatesValue: ImpersonationCandidatesResponse = ImpersonationCandidatesResponse.Session(emptyList())
        var startResult: Result<ImpersonationStatus> =
            Result.success(ImpersonationStatus.Active("admin", "target", "2026-06-05T00:00:00Z"))
        var endResult: Result<Unit> = Result.success(Unit)

        override fun impersonationStatus(): Flow<Resource<ImpersonationStatus>> =
            flow {
                val n = ++statusCollections
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = statusFactory(n), fetchedAt = 1L, stale = false))
            }

        override fun impersonationCandidates(): Flow<Resource<ImpersonationCandidatesResponse>> =
            flow {
                candidatesCollections++
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = candidatesValue, fetchedAt = 1L, stale = false))
            }

        override suspend fun startImpersonation(request: ImpersonationStartRequest): Result<ImpersonationStatus> {
            started += request
            return startResult
        }

        override suspend fun endImpersonation(): Result<Unit> {
            ended++
            return endResult
        }
    }

    @Test
    fun statusEmitsCacheThenNetwork() =
        runTest {
            val repo = FakeImpersonationRepository()
            repo.statusFactory = { ImpersonationStatus.Active("a", "t", "x") }
            val store = ImpersonationStore(repo, backgroundScope)

            val seen = mutableListOf<Resource<ImpersonationStatus>>()
            backgroundScope.launch { store.status.collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(ImpersonationStatus.Active("a", "t", "x"), last.data)
        }

    @Test
    fun candidatesEmitsSessionAndOpen() =
        runTest {
            val repo = FakeImpersonationRepository()
            repo.candidatesValue =
                ImpersonationCandidatesResponse.Session(listOf(ImpersonationCandidate("alice"), ImpersonationCandidate("bob")))
            val store = ImpersonationStore(repo, backgroundScope)

            val seen = mutableListOf<Resource<ImpersonationCandidatesResponse>>()
            backgroundScope.launch { store.candidates.collect { seen += it } }
            runCurrent()

            val session = (seen.last() as Resource.Success).data as ImpersonationCandidatesResponse.Session
            assertEquals(listOf("alice", "bob"), session.candidates.map { it.subject })

            // A second store wired for open mode surfaces the open value without erroring.
            val openRepo = FakeImpersonationRepository().apply { candidatesValue = ImpersonationCandidatesResponse.Open }
            val openStore = ImpersonationStore(openRepo, backgroundScope)
            val openSeen = mutableListOf<Resource<ImpersonationCandidatesResponse>>()
            backgroundScope.launch { openStore.candidates.collect { openSeen += it } }
            runCurrent()
            assertTrue((openSeen.last() as Resource.Success).data is ImpersonationCandidatesResponse.Open)
        }

    @Test
    fun candidatesIsColdUntilObserved() =
        runTest {
            val repo = FakeImpersonationRepository()
            ImpersonationStore(repo, backgroundScope)
            runCurrent()
            // Nobody opted in (web enabled:false analogue): no /candidates query was issued.
            assertEquals(0, repo.candidatesCollections)
        }

    @Test
    fun derivedPredicatesFollowStatus() =
        runTest {
            val repo = FakeImpersonationRepository()
            repo.statusFactory = { ImpersonationStatus.Active("a", "t", "x") }
            val store = ImpersonationStore(repo, backgroundScope)

            val openSeen = mutableListOf<Boolean>()
            val activeSeen = mutableListOf<Boolean>()
            backgroundScope.launch { store.isOpenMode.collect { openSeen += it } }
            backgroundScope.launch { store.isActive.collect { activeSeen += it } }
            runCurrent()

            assertEquals(false, openSeen.last(), "active status is not open mode")
            assertEquals(true, activeSeen.last(), "active status drives isActive=true")
        }

    @Test
    fun openModeStatusDrivesIsOpenMode() =
        runTest {
            val repo = FakeImpersonationRepository()
            repo.statusFactory = { ImpersonationStatus.Open }
            val store = ImpersonationStore(repo, backgroundScope)

            val openSeen = mutableListOf<Boolean>()
            backgroundScope.launch { store.isOpenMode.collect { openSeen += it } }
            runCurrent()
            assertTrue(openSeen.last(), "open status drives isOpenMode=true")
        }

    @Test
    fun startDelegatesAndRefreshesBothObservedFeeds() =
        runTest {
            val repo = FakeImpersonationRepository()
            val store = ImpersonationStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            backgroundScope.launch { store.candidates.collect {} }
            runCurrent()
            assertEquals(1, repo.statusCollections)
            assertEquals(1, repo.candidatesCollections)

            val request = ImpersonationStartRequest(subject = "target-user")
            val result = store.startImpersonation(request)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(request), repo.started)
            // invalidate-all: BOTH observed feeds re-fetch.
            assertEquals(2, repo.statusCollections)
            assertEquals(2, repo.candidatesCollections)
        }

    @Test
    fun endDelegatesAndRefreshesBothObservedFeeds() =
        runTest {
            val repo = FakeImpersonationRepository()
            val store = ImpersonationStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            backgroundScope.launch { store.candidates.collect {} }
            runCurrent()

            val result = store.endImpersonation()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.ended)
            assertEquals(2, repo.statusCollections)
            assertEquals(2, repo.candidatesCollections)
        }

    @Test
    fun failedStartDoesNotRefresh() =
        runTest {
            val repo = FakeImpersonationRepository().apply { startResult = Result.failure(IllegalStateException("boom")) }
            val store = ImpersonationStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.statusCollections)

            val result = store.startImpersonation(ImpersonationStartRequest("x"))
            runCurrent()

            assertTrue(result.isFailure)
            // A failed mutation must NOT restart the feeds (web onSuccess-only invalidation).
            assertEquals(1, repo.statusCollections)
        }

    @Test
    fun refreshAllIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeImpersonationRepository()
            val store = ImpersonationStore(repo, backgroundScope)

            val result = store.startImpersonation(ImpersonationStartRequest("x"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.started.size)
            assertEquals(0, repo.statusCollections, "no feed observed ⇒ no needless upstream restart")
            assertEquals(0, repo.candidatesCollections)
        }
}
