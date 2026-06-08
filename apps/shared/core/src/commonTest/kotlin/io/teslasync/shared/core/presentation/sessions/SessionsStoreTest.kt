package io.teslasync.shared.core.presentation.sessions

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SessionRepository
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
 * Verifies the S8 [SessionsStore] folds the S7 [SessionRepository] into a shared, refreshable list
 * feed and routes each mutation to the right repository call + the web-faithful invalidate behaviour
 * (a successful revoke refreshes the single feed — `sessionKeys.list`; a failed revoke refreshes
 * nothing) — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionsStoreTest {
    /**
     * Fake S7 port: each list collection re-counts (so a refresh is observable) and emits
     * Loading→Success with a configurable response; each mutation records that it was called and
     * succeeds (configurably).
     */
    private class FakeSessionRepository(
        private val response: ActiveSessionsResponse = ActiveSessionsResponse.Session(listOf(row("sess-1", current = true))),
    ) : SessionRepository {
        var collections: Int = 0
            private set
        var revokedIds: MutableList<String> = mutableListOf()
        var revokeAllCalls: Int = 0
            private set
        var mutationSucceeds = true

        override fun sessions(): Flow<Resource<ActiveSessionsResponse>> =
            flow {
                collections += 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = response, fetchedAt = 1L, stale = false))
            }

        override suspend fun revokeSession(id: String): Result<Unit> {
            revokedIds += id
            return if (mutationSucceeds) Result.success(Unit) else Result.failure(IllegalStateException("500"))
        }

        override suspend fun revokeAllOtherSessions(): Result<RevokeAllOthersResponse> {
            revokeAllCalls += 1
            return if (mutationSucceeds) {
                Result.success(RevokeAllOthersResponse(mode = "session", revoked = 3))
            } else {
                Result.failure(IllegalStateException("500"))
            }
        }

        companion object {
            fun row(
                id: String,
                current: Boolean = false,
            ): ActiveSession =
                ActiveSession(
                    id = id,
                    userAgent = "Mozilla/5.0",
                    ip = "10.0.0.1",
                    createdAt = "2026-01-01T00:00:00Z",
                    lastSeenAt = "2026-01-02T00:00:00Z",
                    current = current,
                )
        }
    }

    // ---- Read ---------------------------------------------------------------------

    @Test
    fun startsAtLoadingBeforeAnySubscriber() =
        runTest {
            val store = SessionsStore(FakeSessionRepository(), backgroundScope)
            assertTrue(store.sessions.value is Resource.Loading)
        }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = SessionsStore(FakeSessionRepository(), backgroundScope)
            val seen = mutableListOf<Resource<ActiveSessionsResponse>>()
            backgroundScope.launch { store.sessions.collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            val data = last.data
            assertTrue(data is ActiveSessionsResponse.Session)
            assertEquals("sess-1", data.sessions.first().id)
        }

    @Test
    fun openModeResponseFlowsThroughUnchanged() =
        runTest {
            val store = SessionsStore(FakeSessionRepository(ActiveSessionsResponse.Open), backgroundScope)
            backgroundScope.launch { store.sessions.collect {} }
            runCurrent()

            val value = store.sessions.value
            assertTrue(value is Resource.Success)
            assertEquals(ActiveSessionsResponse.Open, value.data)
        }

    // ---- Mutations ----------------------------------------------------------------

    @Test
    fun revokeSessionDelegatesAndRefreshesTheFeed() =
        runTest {
            val repo = FakeSessionRepository()
            val store = SessionsStore(repo, backgroundScope)
            backgroundScope.launch { store.sessions.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            val result = store.revokeSession("sess-2")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("sess-2"), repo.revokedIds)
            assertEquals(2, repo.collections, "successful revoke refreshes the list feed")
        }

    @Test
    fun revokeAllOthersDelegatesReturnsCountAndRefreshes() =
        runTest {
            val repo = FakeSessionRepository()
            val store = SessionsStore(repo, backgroundScope)
            backgroundScope.launch { store.sessions.collect {} }
            runCurrent()

            val result = store.revokeAllOtherSessions()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(3, result.getOrThrow().revoked)
            assertEquals(1, repo.revokeAllCalls)
            assertEquals(2, repo.collections, "successful revoke-all refreshes the list feed")
        }

    @Test
    fun failedRevokeDoesNotRefresh() =
        runTest {
            val repo = FakeSessionRepository()
            repo.mutationSucceeds = false
            val store = SessionsStore(repo, backgroundScope)
            backgroundScope.launch { store.sessions.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            val result = store.revokeSession("sess-2")
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.collections, "onError ⇒ no invalidation")
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeSessionRepository()
            val store = SessionsStore(repo, backgroundScope)
            backgroundScope.launch { store.sessions.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            store.refresh()
            runCurrent()
            assertEquals(2, repo.collections, "refresh re-collects the list")
        }

    @Test
    fun refreshIsNoOpWithoutASubscriber() =
        runTest {
            val repo = FakeSessionRepository()
            val store = SessionsStore(repo, backgroundScope)

            store.refresh()
            runCurrent()
            assertEquals(0, repo.collections, "an unobserved feed never fetches")
        }
}
