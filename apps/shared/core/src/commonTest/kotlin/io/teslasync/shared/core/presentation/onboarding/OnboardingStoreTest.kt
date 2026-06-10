package io.teslasync.shared.core.presentation.onboarding

import io.teslasync.shared.core.data.repo.OnboardingRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Verifies the S8 [OnboardingStore] folds the S7 [OnboardingRepository] gate into a shared,
 * self-polling cache-then-network [Resource] flow — using a fake repository, so no network or cache
 * is involved. Mirrors the web `useOnboardingStatus` hook: emit cache→network, re-fetch every 30s
 * WHILE incomplete, and stop the moment `is_complete` flips true.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingStoreTest {
    /** Fake S7 port returning a queued status per collection (last repeats), counting its reads. */
    private class FakeOnboardingRepository(
        private val statuses: List<OnboardingStatus>,
    ) : OnboardingRepository {
        var calls: Int = 0
            private set

        override fun status(): Flow<Resource<OnboardingStatus>> =
            flow {
                val index = if (calls < statuses.size) calls else statuses.size - 1
                calls += 1
                val s = statuses[index]
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = s, fetchedAt = 1L, stale = false))
            }
    }

    private fun status(
        teslaConnected: Boolean = false,
        vehicleCount: Int = 0,
        dataFlowing: Boolean = false,
        isComplete: Boolean = false,
    ): OnboardingStatus =
        OnboardingStatus(
            teslaConnected = teslaConnected,
            vehicleCount = vehicleCount,
            dataFlowing = dataFlowing,
            isComplete = isComplete,
        )

    private val incomplete = status(teslaConnected = true)
    private val complete = status(teslaConnected = true, vehicleCount = 1, dataFlowing = true, isComplete = true)

    @Test
    fun startsLoadingBeforeAnySubscriber() =
        runTest {
            val store = OnboardingStore(FakeOnboardingRepository(listOf(complete)), backgroundScope, 30_000)
            // No subscriber yet: the StateFlow holds its Loading initial value and never reads.
            assertTrue(store.status.value is Resource.Loading)
        }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val repo = FakeOnboardingRepository(listOf(complete))
            val store = OnboardingStore(repo, backgroundScope, 30_000)
            val seen = mutableListOf<Resource<OnboardingStatus>>()
            backgroundScope.launch { store.status.collect { seen += it } }
            runCurrent()

            assertEquals(1, repo.calls, "subscription triggers an immediate read")
            assertTrue(seen.first() is Resource.Loading, "first emission is the cache slot")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network success")
            assertEquals(complete, last.data)
        }

    @Test
    fun reReadsOnEachPollIntervalWhileIncomplete() =
        runTest {
            val repo = FakeOnboardingRepository(listOf(incomplete, incomplete, complete))
            val store = OnboardingStore(repo, backgroundScope, 30_000)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.calls)

            advanceTimeBy(30_000)
            runCurrent()
            assertEquals(2, repo.calls, "the poll interval drives a second read while incomplete")

            advanceTimeBy(30_000)
            runCurrent()
            assertEquals(3, repo.calls, "polling continues while incomplete")
        }

    @Test
    fun stopsPollingOnceComplete() =
        runTest {
            val repo = FakeOnboardingRepository(listOf(complete))
            val store = OnboardingStore(repo, backgroundScope, 30_000)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.calls)

            advanceTimeBy(30_000)
            runCurrent()
            advanceTimeBy(30_000)
            runCurrent()
            assertEquals(1, repo.calls, "a completed gate stops the poll loop")
            assertTrue(store.status.value is Resource.Success, "the completed status stays the terminal value")
        }

    @Test
    fun stopsPollingTheCycleAfterCompletionFlips() =
        runTest {
            // incomplete → (30s) → complete → must NOT read again.
            val repo = FakeOnboardingRepository(listOf(incomplete, complete))
            val store = OnboardingStore(repo, backgroundScope, 30_000)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.calls)

            advanceTimeBy(30_000)
            runCurrent()
            assertEquals(2, repo.calls, "polls once more while still incomplete")

            advanceTimeBy(30_000)
            runCurrent()
            assertEquals(2, repo.calls, "no further read once the gate has completed")
        }

    @Test
    fun doesNotReadWithoutASubscriber() =
        runTest {
            val repo = FakeOnboardingRepository(listOf(incomplete))
            OnboardingStore(repo, backgroundScope, 30_000)
            runCurrent()
            advanceTimeBy(120_000)
            runCurrent()
            assertEquals(0, repo.calls, "an unobserved onboarding store never reads")
        }

    @Test
    fun refreshRestartsThePollLoopImmediately() =
        runTest {
            // A completed gate has stopped polling; refresh() forces an immediate re-read — the
            // TanStack refetch analogue consumers call after kicking off a connect / sync.
            val repo = FakeOnboardingRepository(listOf(complete))
            val store = OnboardingStore(repo, backgroundScope, 30_000)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.calls)

            store.refresh()
            runCurrent()
            assertEquals(2, repo.calls, "refresh re-reads even after polling has stopped")
        }
}
