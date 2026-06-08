package io.teslasync.shared.core.presentation.authmode

import io.teslasync.shared.core.data.repo.AuthModeRepository
import io.teslasync.shared.core.data.repo.AuthModeResponse
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
 * Verifies the S8 [AuthModeStore] folds the S7 [AuthModeRepository] into a shared, refreshable
 * contract flow and the two web derivations — using a fake repository, so no network or cache is
 * involved. Mirrors the web `useAuthMode` domain: one read, no mutations, plus `useIsForwardAuth`
 * and `useAuthSubject` derived from it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuthModeStoreTest {
    /** Fake S7 port: each collection re-counts (so a refresh is observable) and emits Loading→Success. */
    private class FakeAuthModeRepository(
        private val response: AuthModeResponse,
    ) : AuthModeRepository {
        var collections: Int = 0
            private set

        override fun authMode(): Flow<Resource<AuthModeResponse>> =
            flow {
                collections += 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = response, fetchedAt = 1L, stale = false))
            }
    }

    private fun forwardAuth(subject: String?): AuthModeResponse = AuthModeResponse(mode = "forward_auth", subject = subject)

    private fun open(): AuthModeResponse = AuthModeResponse(mode = "open")

    @Test
    fun startsAtSafeDefaultsBeforeAnySubscriber() =
        runTest {
            val store = AuthModeStore(FakeAuthModeRepository(forwardAuth("alice@example.com")), backgroundScope)
            assertTrue(store.authMode.value is Resource.Loading)
            assertEquals(false, store.isForwardAuth.value)
            assertEquals(null, store.authSubject.value)
        }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AuthModeStore(FakeAuthModeRepository(forwardAuth("alice@example.com")), backgroundScope)
            val seen = mutableListOf<Resource<AuthModeResponse>>()
            backgroundScope.launch { store.authMode.collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("forward_auth", last.data.mode)
        }

    @Test
    fun derivesForwardAuthAndSubject() =
        runTest {
            val store = AuthModeStore(FakeAuthModeRepository(forwardAuth("alice@example.com")), backgroundScope)
            backgroundScope.launch { store.isForwardAuth.collect {} }
            backgroundScope.launch { store.authSubject.collect {} }
            runCurrent()

            assertEquals(true, store.isForwardAuth.value)
            assertEquals("alice@example.com", store.authSubject.value)
        }

    @Test
    fun openModeDerivesFalseAndNullSubject() =
        runTest {
            val store = AuthModeStore(FakeAuthModeRepository(open()), backgroundScope)
            backgroundScope.launch { store.isForwardAuth.collect {} }
            backgroundScope.launch { store.authSubject.collect {} }
            runCurrent()

            assertEquals(false, store.isForwardAuth.value)
            assertEquals(null, store.authSubject.value)
        }

    @Test
    fun forwardAuthWithStrippedSubjectDerivesNull() =
        runTest {
            val store = AuthModeStore(FakeAuthModeRepository(forwardAuth(null)), backgroundScope)
            backgroundScope.launch { store.isForwardAuth.collect {} }
            backgroundScope.launch { store.authSubject.collect {} }
            runCurrent()

            assertEquals(true, store.isForwardAuth.value)
            assertEquals(null, store.authSubject.value)
        }

    @Test
    fun refreshReFetchesTheObservedContract() =
        runTest {
            val repo = FakeAuthModeRepository(forwardAuth("alice@example.com"))
            val store = AuthModeStore(repo, backgroundScope)
            backgroundScope.launch { store.authMode.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            store.refresh()
            runCurrent()
            assertEquals(2, repo.collections, "refresh re-collects the contract")
        }

    @Test
    fun refreshIsNoOpWithoutASubscriber() =
        runTest {
            val repo = FakeAuthModeRepository(forwardAuth("alice@example.com"))
            val store = AuthModeStore(repo, backgroundScope)

            store.refresh()
            runCurrent()
            assertEquals(0, repo.collections, "an unobserved contract never fetches")
        }
}
