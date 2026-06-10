package io.teslasync.shared.core.presentation.locations

import io.teslasync.shared.core.data.repo.LocationRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.geofencesKey
import io.teslasync.shared.core.data.repo.visitedLocationsKey
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
 * Verifies the S8 [LocationsStore] folds the S7 [LocationRepository] into shared, refreshable feeds,
 * honours the `enabled: !!vehicleId` gate, and routes the bulk-delete mutation to the right
 * repository call + a geofences-only refresh (never the visited-location list) — using a fake
 * repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocationsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per key (so a refresh is observable) and
     * emits Loading→Success with a single deterministic row; the mutation records its argument and
     * succeeds.
     */
    private class FakeLocationRepository : LocationRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val deleted: MutableList<List<Long>> = mutableListOf()

        override fun visitedLocations(vehicleId: String): Flow<Resource<List<VisitedLocation>>> =
            flow {
                val key = visitedLocationsKey(vehicleId)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(location(n.toLong())), fetchedAt = 1L, stale = false))
            }

        override fun geofences(): Flow<Resource<List<Geofence>>> =
            flow {
                val key = geofencesKey()
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(geofence(n.toLong())), fetchedAt = 1L, stale = false))
            }

        override suspend fun bulkDeleteGeofences(ids: List<Long>): Result<GeofenceBulkResult> {
            deleted += ids
            return Result.success(GeofenceBulkResult(deleted = ids.size.toLong()))
        }

        companion object {
            fun location(id: Long): VisitedLocation =
                VisitedLocation(
                    id = id,
                    vehicleId = 7,
                    addressName = "loc-$id",
                    visitCount = 3,
                    totalDurationS = 1_200,
                    createdAt = "2026-01-01T00:00:00Z",
                )

            fun geofence(id: Long): Geofence =
                Geofence(
                    id = id,
                    name = "fence-$id",
                    polygonWkt = "POLYGON((0 0,0 1,1 1,1 0,0 0))",
                    enabled = true,
                    createdAt = "2026-01-01T00:00:00Z",
                    updatedAt = "2026-01-01T00:00:00Z",
                )
        }
    }

    @Test
    fun visitedLocationsEmitsCacheThenNetwork() =
        runTest {
            val store = LocationsStore(FakeLocationRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<VisitedLocation>>>()
            backgroundScope.launch { store.visitedLocations("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("loc-1", last.data.first().addressName)
        }

    @Test
    fun geofencesEmitsCacheThenNetwork() =
        runTest {
            val store = LocationsStore(FakeLocationRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<Geofence>>>()
            backgroundScope.launch { store.geofences().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals("fence-1", last.data.first().name)
        }

    @Test
    fun visitedLocationsIsDisabledWithoutAVehicleId() =
        runTest {
            val repo = FakeLocationRepository()
            val store = LocationsStore(repo, backgroundScope)

            // Null and empty ids collapse to ONE stable disabled instance that never fetches.
            assertSame(store.visitedLocations(null), store.visitedLocations(""))
            backgroundScope.launch { store.visitedLocations(null).collect {} }
            runCurrent()
            assertTrue(repo.collections.isEmpty(), "a disabled feed must never hit the repository")
            assertTrue(store.visitedLocations(null).value is Resource.Loading)
        }

    @Test
    fun sameVehicleSharesUpstreamAndDistinctVehiclesAreDistinctFeeds() =
        runTest {
            val store = LocationsStore(FakeLocationRepository(), backgroundScope)
            assertSame(store.visitedLocations("7"), store.visitedLocations("7"))
            assertTrue(store.visitedLocations("7") !== store.visitedLocations("9"))
            // The geofences feed is a single shared instance.
            assertSame(store.geofences(), store.geofences())
        }

    @Test
    fun bulkDeleteDelegatesAndRefreshesOnlyTheGeofencesFeed() =
        runTest {
            val repo = FakeLocationRepository()
            val store = LocationsStore(repo, backgroundScope)
            backgroundScope.launch { store.geofences().collect {} }
            backgroundScope.launch { store.visitedLocations("7").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[geofencesKey()])
            assertEquals(1, repo.collections[visitedLocationsKey("7")])

            val result = store.bulkDeleteGeofences(listOf(1L, 2L))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(2L, result.getOrThrow().deleted)
            assertEquals(listOf(listOf(1L, 2L)), repo.deleted)
            // ONLY the geofences feed re-fetched; the visited-location list is untouched.
            assertEquals(2, repo.collections[geofencesKey()])
            assertEquals(1, repo.collections[visitedLocationsKey("7")])
        }

    @Test
    fun bulkDeleteIsNoOpRefreshWhenGeofencesNotObserved() =
        runTest {
            val repo = FakeLocationRepository()
            val store = LocationsStore(repo, backgroundScope)

            val result = store.bulkDeleteGeofences(listOf(1L))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.deleted.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
