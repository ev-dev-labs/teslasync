package io.teslasync.shared.core.presentation.rbacmatrix

import io.teslasync.shared.core.data.repo.RbacRepository
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
 * Verifies the S8 [RbacMatrixStore] folds the S7 [RbacRepository] into a shared, refreshable feed,
 * derives the open-mode predicate off the SAME upstream, routes the save to the right repository
 * call with an on-success-only refresh, and re-exposes the snapshot diff — using a fake repository,
 * so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RbacMatrixStoreTest {
    /**
     * Fake S7 port: the read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success with a deterministic value; the mutation records its argument and returns the
     * configured [Result].
     */
    private class FakeRbacRepository : RbacRepository {
        var matrixCollections = 0
        val upserted = mutableListOf<List<RbacUpsertCell>>()

        var matrixFactory: (Int) -> RbacMatrixResponse = { RbacMatrixSession() }
        var upsertResult: Result<Unit> = Result.success(Unit)

        override fun matrix(): Flow<Resource<RbacMatrixResponse>> =
            flow {
                val n = ++matrixCollections
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = matrixFactory(n), fetchedAt = 1L, stale = false))
            }

        override suspend fun upsertCells(cells: List<RbacUpsertCell>): Result<Unit> {
            upserted += cells
            return upsertResult
        }
    }

    @Test
    fun matrixEmitsCacheThenNetwork() =
        runTest {
            val repo = FakeRbacRepository()
            val session =
                RbacMatrixSession(
                    roles = listOf(RbacRole("admin", "admin")),
                    permissions = listOf(RbacPermission("vehicles.read", "vehicles.read", "vehicles")),
                    matrix = mapOf("admin" to mapOf("vehicles.read" to true)),
                )
            repo.matrixFactory = { session }
            val store = RbacMatrixStore(repo, backgroundScope)

            val seen = mutableListOf<Resource<RbacMatrixResponse>>()
            backgroundScope.launch { store.matrix.collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(session, last.data)
        }

    @Test
    fun openModeMatrixDrivesIsOpenMode() =
        runTest {
            val repo = FakeRbacRepository().apply { matrixFactory = { RbacMatrixResponse.Open } }
            val store = RbacMatrixStore(repo, backgroundScope)

            val openSeen = mutableListOf<Boolean>()
            backgroundScope.launch { store.isOpenMode.collect { openSeen += it } }
            runCurrent()
            assertTrue(openSeen.last(), "open-mode read drives isOpenMode=true")
        }

    @Test
    fun sessionMatrixIsNotOpenMode() =
        runTest {
            val repo = FakeRbacRepository().apply { matrixFactory = { RbacMatrixSession() } }
            val store = RbacMatrixStore(repo, backgroundScope)

            val openSeen = mutableListOf<Boolean>()
            backgroundScope.launch { store.isOpenMode.collect { openSeen += it } }
            runCurrent()
            assertEquals(false, openSeen.last(), "session read is not open mode")
        }

    @Test
    fun upsertDelegatesAndRefreshesObservedFeed() =
        runTest {
            val repo = FakeRbacRepository()
            val store = RbacMatrixStore(repo, backgroundScope)
            backgroundScope.launch { store.matrix.collect {} }
            runCurrent()
            assertEquals(1, repo.matrixCollections)

            val cells = listOf(RbacUpsertCell("admin", "vehicles.read", true))
            val result = store.upsertCells(cells)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(cells), repo.upserted)
            // onSuccess invalidates rbacMatrixKeys.matrix() ⇒ the observed feed re-fetches.
            assertEquals(2, repo.matrixCollections)
        }

    @Test
    fun emptyBatchStillRefreshesOnSuccess() =
        runTest {
            val repo = FakeRbacRepository()
            val store = RbacMatrixStore(repo, backgroundScope)
            backgroundScope.launch { store.matrix.collect {} }
            runCurrent()

            val result = store.upsertCells(emptyList())
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(emptyList<RbacUpsertCell>()), repo.upserted)
            assertEquals(2, repo.matrixCollections, "empty no-op save still runs onSuccess refresh")
        }

    @Test
    fun failedUpsertDoesNotRefresh() =
        runTest {
            val repo = FakeRbacRepository().apply { upsertResult = Result.failure(IllegalStateException("boom")) }
            val store = RbacMatrixStore(repo, backgroundScope)
            backgroundScope.launch { store.matrix.collect {} }
            runCurrent()
            assertEquals(1, repo.matrixCollections)

            val result = store.upsertCells(listOf(RbacUpsertCell("admin", "vehicles.read", true)))
            runCurrent()

            assertTrue(result.isFailure)
            // A failed save must NOT restart the feed (web onSuccess-only invalidation).
            assertEquals(1, repo.matrixCollections)
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeRbacRepository()
            val store = RbacMatrixStore(repo, backgroundScope)

            val result = store.upsertCells(listOf(RbacUpsertCell("admin", "vehicles.read", true)))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.upserted.size)
            assertEquals(0, repo.matrixCollections, "no feed observed ⇒ no needless upstream restart")
        }

    @Test
    fun diffMatricesIsExposedFromTheStore() =
        runTest {
            val repo = FakeRbacRepository()
            val store = RbacMatrixStore(repo, backgroundScope)

            val base = mapOf("admin" to mapOf("vehicles.read" to true))
            val draft = mapOf("admin" to mapOf("vehicles.read" to false))
            assertEquals(
                listOf(RbacUpsertCell("admin", "vehicles.read", false)),
                store.diffMatrices(base, draft),
            )
        }
}
