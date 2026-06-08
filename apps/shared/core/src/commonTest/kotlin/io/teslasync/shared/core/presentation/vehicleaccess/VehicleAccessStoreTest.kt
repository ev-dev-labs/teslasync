package io.teslasync.shared.core.presentation.vehicleaccess

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleAccessRepository
import io.teslasync.shared.core.data.repo.vehicleDriversCacheKey
import io.teslasync.shared.core.data.repo.vehicleInvitationsCacheKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [VehicleAccessStore] folds the S7 [VehicleAccessRepository] into shared,
 * refreshable feeds and routes each mutation to the right repository call + the right per-vehicle,
 * per-feed refresh — using a fake repository, so no network or cache is involved. The invalidation
 * granularity (only the affected vehicle's affected feed; never the sibling feed; never another
 * vehicle) is the behaviour under test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleAccessStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections per key (so a refresh is observable) and
     * emits Loading→Success with a deterministic payload; each mutation records its arguments and
     * succeeds.
     */
    private class FakeVehicleAccessRepository : VehicleAccessRepository {
        val driverCollections: MutableMap<String, Int> = mutableMapOf()
        val invitationCollections: MutableMap<String, Int> = mutableMapOf()
        val driversRefreshed: MutableList<String> = mutableListOf()
        val invitationsRefreshed: MutableList<String> = mutableListOf()
        val removed: MutableList<Pair<String, Long>> = mutableListOf()
        val created: MutableList<String> = mutableListOf()
        val revoked: MutableList<Pair<String, String>> = mutableListOf()

        override fun vehicleDrivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>> =
            flow {
                val key = vehicleDriversCacheKey(vehicleId)
                val n = (driverCollections[key] ?: 0) + 1
                driverCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(driverRow(vehicleId, n)), fetchedAt = 1L, stale = false))
            }

        override fun vehicleInvitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>> =
            flow {
                val key = vehicleInvitationsCacheKey(vehicleId)
                val n = (invitationCollections[key] ?: 0) + 1
                invitationCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(invitationRow(vehicleId, n)), fetchedAt = 1L, stale = false))
            }

        override suspend fun refreshVehicleDrivers(vehicleId: String): Result<List<VehicleDriver>> {
            driversRefreshed += vehicleId
            return Result.success(listOf(driverRow(vehicleId, 0)))
        }

        override suspend fun refreshVehicleInvitations(vehicleId: String): Result<List<VehicleInvitation>> {
            invitationsRefreshed += vehicleId
            return Result.success(listOf(invitationRow(vehicleId, 0)))
        }

        override suspend fun removeVehicleDriver(
            vehicleId: String,
            shareUserId: Long,
        ): Result<Unit> {
            removed += vehicleId to shareUserId
            return Result.success(Unit)
        }

        override suspend fun createVehicleInvitation(vehicleId: String): Result<VehicleInvitation> {
            created += vehicleId
            return Result.success(invitationRow(vehicleId, 0))
        }

        override suspend fun revokeVehicleInvitation(
            vehicleId: String,
            invitationId: String,
        ): Result<Unit> {
            revoked += vehicleId to invitationId
            return Result.success(Unit)
        }

        companion object {
            fun driverRow(
                vehicleId: String,
                n: Int,
            ): VehicleDriver =
                VehicleDriver(
                    id = n.toLong(),
                    vehicleId = vehicleId.toLongOrNull() ?: 0L,
                    shareUserId = 7L,
                    driverEmail = "d$n@x",
                    driverName = "Driver $n",
                    role = "driver",
                    fetchedAt = "2026-01-01T00:00:00Z",
                )

            fun invitationRow(
                vehicleId: String,
                n: Int,
            ): VehicleInvitation =
                VehicleInvitation(
                    id = n.toLong(),
                    vehicleId = vehicleId.toLongOrNull() ?: 0L,
                    invitationId = "inv-$vehicleId-$n",
                    inviteUrl = "https://x/$vehicleId/$n",
                    status = "pending",
                    fetchedAt = "2026-01-01T00:00:00Z",
                    createdAt = "2026-01-01T00:00:00Z",
                )
        }
    }

    @Test
    fun vehicleDriversReadEmitsCacheThenNetwork() =
        runTest {
            val store = VehicleAccessStore(FakeVehicleAccessRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<VehicleDriver>>>()
            backgroundScope.launch { store.vehicleDrivers("42").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(1, last.data.size)
        }

    @Test
    fun vehicleInvitationsReadEmitsCacheThenNetwork() =
        runTest {
            val store = VehicleAccessStore(FakeVehicleAccessRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<VehicleInvitation>>>()
            backgroundScope.launch { store.vehicleInvitations("42").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals("inv-42-1", last.data.single().invitationId)
        }

    @Test
    fun sameVehicleSharesUpstreamAndDistinctVehiclesAreDistinctFeeds() =
        runTest {
            val store = VehicleAccessStore(FakeVehicleAccessRepository(), backgroundScope)
            assertSame(store.vehicleDrivers("42"), store.vehicleDrivers("42"))
            assertNotSame(store.vehicleDrivers("42"), store.vehicleDrivers("43"))
            assertSame(store.vehicleInvitations("42"), store.vehicleInvitations("42"))
            assertNotSame(store.vehicleInvitations("42"), store.vehicleInvitations("43"))
        }

    @Test
    fun driverAndInvitationFeedsForSameVehicleAreDistinct() =
        runTest {
            val store = VehicleAccessStore(FakeVehicleAccessRepository(), backgroundScope)
            assertNotSame<Any>(store.vehicleDrivers("42"), store.vehicleInvitations("42"))
        }

    @Test
    fun refreshVehicleDriversDelegatesAndRefreshesOnlyThatDriversFeed() =
        runTest {
            val repo = FakeVehicleAccessRepository()
            val store = VehicleAccessStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicleDrivers("42").collect {} }
            backgroundScope.launch { store.vehicleDrivers("99").collect {} }
            backgroundScope.launch { store.vehicleInvitations("42").collect {} }
            runCurrent()
            assertEquals(1, repo.driverCollections[vehicleDriversCacheKey("42")])
            assertEquals(1, repo.driverCollections[vehicleDriversCacheKey("99")])
            assertEquals(1, repo.invitationCollections[vehicleInvitationsCacheKey("42")])

            val result = store.refreshVehicleDrivers("42")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42"), repo.driversRefreshed)
            // Only vehicle 42's drivers feed re-fetched; vehicle 99 + the invitations feed untouched.
            assertEquals(2, repo.driverCollections[vehicleDriversCacheKey("42")])
            assertEquals(1, repo.driverCollections[vehicleDriversCacheKey("99")])
            assertEquals(1, repo.invitationCollections[vehicleInvitationsCacheKey("42")])
        }

    @Test
    fun refreshVehicleInvitationsDelegatesAndRefreshesOnlyThatInvitationsFeed() =
        runTest {
            val repo = FakeVehicleAccessRepository()
            val store = VehicleAccessStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicleInvitations("42").collect {} }
            backgroundScope.launch { store.vehicleDrivers("42").collect {} }
            runCurrent()
            assertEquals(1, repo.invitationCollections[vehicleInvitationsCacheKey("42")])
            assertEquals(1, repo.driverCollections[vehicleDriversCacheKey("42")])

            val result = store.refreshVehicleInvitations("42")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42"), repo.invitationsRefreshed)
            assertEquals(2, repo.invitationCollections[vehicleInvitationsCacheKey("42")])
            // The drivers feed is never refreshed by an invitation action.
            assertEquals(1, repo.driverCollections[vehicleDriversCacheKey("42")])
        }

    @Test
    fun removeVehicleDriverDelegatesAndRefreshesOnlyThatDriversFeed() =
        runTest {
            val repo = FakeVehicleAccessRepository()
            val store = VehicleAccessStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicleDrivers("42").collect {} }
            backgroundScope.launch { store.vehicleInvitations("42").collect {} }
            runCurrent()

            val result = store.removeVehicleDriver("42", 7L)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42" to 7L), repo.removed)
            assertEquals(2, repo.driverCollections[vehicleDriversCacheKey("42")])
            assertEquals(1, repo.invitationCollections[vehicleInvitationsCacheKey("42")])
        }

    @Test
    fun createVehicleInvitationDelegatesAndRefreshesOnlyThatInvitationsFeed() =
        runTest {
            val repo = FakeVehicleAccessRepository()
            val store = VehicleAccessStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicleInvitations("42").collect {} }
            backgroundScope.launch { store.vehicleDrivers("42").collect {} }
            runCurrent()

            val result = store.createVehicleInvitation("42")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42"), repo.created)
            assertEquals(2, repo.invitationCollections[vehicleInvitationsCacheKey("42")])
            assertEquals(1, repo.driverCollections[vehicleDriversCacheKey("42")])
        }

    @Test
    fun revokeVehicleInvitationDelegatesAndRefreshesOnlyThatInvitationsFeed() =
        runTest {
            val repo = FakeVehicleAccessRepository()
            val store = VehicleAccessStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicleInvitations("42").collect {} }
            backgroundScope.launch { store.vehicleDrivers("42").collect {} }
            runCurrent()

            val result = store.revokeVehicleInvitation("42", "inv-xyz")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42" to "inv-xyz"), repo.revoked)
            assertEquals(2, repo.invitationCollections[vehicleInvitationsCacheKey("42")])
            assertEquals(1, repo.driverCollections[vehicleDriversCacheKey("42")])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeVehicleAccessRepository()
            val store = VehicleAccessStore(repo, backgroundScope)

            val result = store.refreshVehicleDrivers("42")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.driversRefreshed.size)
            assertTrue(repo.driverCollections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
