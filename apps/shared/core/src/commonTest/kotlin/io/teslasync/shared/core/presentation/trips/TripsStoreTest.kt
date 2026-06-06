package io.teslasync.shared.core.presentation.trips

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TripsRepository
import io.teslasync.shared.core.data.repo.tripDetailKey
import io.teslasync.shared.core.data.repo.tripsListKey
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
 * Verifies the S8 [TripsStore] folds the S7 [TripsRepository] into shared, refreshable feeds keyed by
 * the web TanStack query keys, that each read emits cache→network, and that [TripsStore.refresh]
 * re-collects EXACTLY the web `tripKeys.all` (`['trips']`) family — both the list and the detail.
 * Uses a fake repository, so no network or cache is involved. Each fake read counts its collections
 * under the same cache key the store observes (computed via the shared key builders), so a refresh is
 * directly observable per feed.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TripsStoreTest {
    private class FakeTripsRepository : TripsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        private fun <T> counting(
            key: String,
            value: (Int) -> T,
        ): Flow<Resource<T>> =
            flow {
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value(n), fetchedAt = 1L, stale = false))
            }

        override fun trips(params: TripsParams): Flow<Resource<List<Trip>>> = counting(tripsListKey(params)) { listOf(trip(it.toLong())) }

        override fun trip(id: String): Flow<Resource<Trip>> = counting(tripDetailKey(id)) { trip(id.toLongOrNull() ?: 0L) }

        companion object {
            fun trip(id: Long): Trip =
                Trip(
                    id = id,
                    vehicleId = 7,
                    startDate = "2026-01-01T00:00:00Z",
                    startedAt = "2026-01-01T00:00:00Z",
                    totalDistanceM = 1234.5,
                    totalEnergyWh = 6789.0,
                    totalDurationS = 600,
                    totalCost = 1.23,
                    driveCount = 2,
                    chargeCount = 1,
                    createdAt = "2026-01-01T00:10:00Z",
                )
        }
    }

    // ---- Reads --------------------------------------------------------------------

    @Test
    fun listReadEmitsCacheThenNetwork() =
        runTest {
            val store = TripsStore(FakeTripsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<Trip>>>()
            backgroundScope.launch { store.trips(TripsParams(vehicleId = 7)).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(1, last.data.size)
        }

    @Test
    fun detailReadEmitsCacheThenNetwork() =
        runTest {
            val store = TripsStore(FakeTripsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<Trip>>()
            backgroundScope.launch { store.trip("5").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(5L, last.data.id)
        }

    @Test
    fun sameArgsShareUpstreamAndDistinctArgsAreDistinctFeeds() =
        runTest {
            val store = TripsStore(FakeTripsRepository(), backgroundScope)
            // Same params object value ⇒ same shared feed.
            assertSame(store.trips(TripsParams(vehicleId = 7)), store.trips(TripsParams(vehicleId = 7)))
            // Different params ⇒ distinct feeds.
            assertTrue(store.trips(TripsParams(vehicleId = 7)) !== store.trips(TripsParams(vehicleId = 8)))
            // The default (empty) list feed is distinct from any filtered one and from a detail.
            assertTrue(store.trips() !== store.trips(TripsParams(vehicleId = 7)))
            assertSame(store.trip("5"), store.trip("5"))
            assertTrue(store.trip("5") !== store.trip("6"))
        }

    // ---- Refresh ------------------------------------------------------------------

    @Test
    fun refreshReCollectsBothListAndDetailFamily() =
        runTest {
            val repo = FakeTripsRepository()
            val store = TripsStore(repo, backgroundScope)
            val listParams = TripsParams(vehicleId = 7)
            backgroundScope.launch { store.trips(listParams).collect {} }
            backgroundScope.launch { store.trips().collect {} }
            backgroundScope.launch { store.trip("5").collect {} }
            runCurrent()

            assertEquals(1, repo.collections[tripsListKey(listParams)])
            assertEquals(1, repo.collections[tripsListKey(TripsParams())])
            assertEquals(1, repo.collections[tripDetailKey("5")])

            store.refresh()
            runCurrent()

            // ['trips'] prefix → every observed list AND detail feed re-fetches.
            assertEquals(2, repo.collections[tripsListKey(listParams)])
            assertEquals(2, repo.collections[tripsListKey(TripsParams())])
            assertEquals(2, repo.collections[tripDetailKey("5")])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeTripsRepository()
            val store = TripsStore(repo, backgroundScope)

            store.refresh()
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
            assertNull(repo.collections[tripsListKey(TripsParams())])
        }
}
