package io.teslasync.shared.core.presentation.dashboard

import io.teslasync.shared.core.data.repo.DashboardRepository
import io.teslasync.shared.core.data.repo.DashboardStats
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
 * Verifies the S8 [DashboardStore] folds the S7 [DashboardRepository] into a shared, refreshable
 * summary flow — using a fake repository, so no network or cache is involved. Mirrors the web
 * `useDashboard` domain (web/src/api/hooks/useDashboard.ts): one read (`useDashboardStats`), no
 * mutations, no derivation.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardStoreTest {
    /** Fake S7 port: each collection re-counts (so a refresh is observable) and emits Loading→Success. */
    private class FakeDashboardRepository(
        private val response: DashboardStats,
    ) : DashboardRepository {
        var collections: Int = 0
            private set

        override fun stats(): Flow<Resource<DashboardStats>> =
            flow {
                collections += 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = response, fetchedAt = 1L, stale = false))
            }
    }

    private fun sample(): DashboardStats =
        DashboardStats(
            totalVehicles = 3,
            totalM = 1_234_567.0,
            totalEnergyWh = 89_000.0,
            totalChargingSessions = 42,
            totalTrips = 128,
            avgEfficiency = 0.18,
            totalCostCents = 9_900,
        )

    @Test
    fun startsAtLoadingBeforeAnySubscriber() =
        runTest {
            val store = DashboardStore(FakeDashboardRepository(sample()), backgroundScope)
            assertTrue(store.stats.value is Resource.Loading)
        }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = DashboardStore(FakeDashboardRepository(sample()), backgroundScope)
            val seen = mutableListOf<Resource<DashboardStats>>()
            backgroundScope.launch { store.stats.collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            // SI values pass through verbatim — no conversion in the holder.
            assertEquals(1_234_567.0, last.data.totalM)
            assertEquals(89_000.0, last.data.totalEnergyWh)
            assertEquals(3, last.data.totalVehicles)
            assertEquals(9_900, last.data.totalCostCents)
        }

    @Test
    fun refreshReFetchesTheObservedSummary() =
        runTest {
            val repo = FakeDashboardRepository(sample())
            val store = DashboardStore(repo, backgroundScope)
            backgroundScope.launch { store.stats.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            store.refresh()
            runCurrent()
            assertEquals(2, repo.collections, "refresh re-collects the summary")
        }

    @Test
    fun refreshIsNoOpWithoutASubscriber() =
        runTest {
            val repo = FakeDashboardRepository(sample())
            val store = DashboardStore(repo, backgroundScope)

            store.refresh()
            runCurrent()
            assertEquals(0, repo.collections, "an unobserved summary never fetches")
        }
}
