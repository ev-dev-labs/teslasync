package io.teslasync.shared.core.presentation.dashboardlayouts

import io.teslasync.shared.core.data.repo.DashboardLayoutRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.dashboardLayoutCacheKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [DashboardLayoutsStore] folds the S7 [DashboardLayoutRepository] into shared,
 * refreshable per-scope feeds and routes each mutation to the right repository call + an
 * invalidate-all refresh — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardLayoutsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per `vehicleId` scope key (so a refresh is
     * observable) and emits Loading→Success with a single deterministic row; every mutation records
     * its argument and succeeds.
     */
    private class FakeDashboardLayoutRepository : DashboardLayoutRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val created: MutableList<CreateDashboardLayoutInput> = mutableListOf()
        val updated: MutableList<UpdateDashboardLayoutInput> = mutableListOf()
        val deleted: MutableList<Long> = mutableListOf()
        val applied: MutableList<Long> = mutableListOf()

        override fun namedLayouts(vehicleId: Long?): Flow<Resource<List<NamedDashboardLayout>>> =
            flow {
                val key = dashboardLayoutCacheKey(vehicleId)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(row(n.toLong())), fetchedAt = 1L, stale = false))
            }

        override suspend fun createLayout(input: CreateDashboardLayoutInput): Result<NamedDashboardLayout> {
            created += input
            return Result.success(row(1))
        }

        override suspend fun updateLayout(input: UpdateDashboardLayoutInput): Result<NamedDashboardLayout> {
            updated += input
            return Result.success(row(input.id))
        }

        override suspend fun deleteLayout(id: Long): Result<Unit> {
            deleted += id
            return Result.success(Unit)
        }

        override suspend fun applyLayout(id: Long): Result<NamedDashboardLayout> {
            applied += id
            return Result.success(row(id))
        }

        companion object {
            fun row(id: Long): NamedDashboardLayout =
                NamedDashboardLayout(
                    id = id,
                    vehicleId = 7,
                    name = "layout-$id",
                    isDefault = false,
                    layout = blob(),
                    createdAt = "2026-01-01T00:00:00Z",
                    updatedAt = "2026-01-01T00:00:00Z",
                )

            fun blob(): JsonObject = buildJsonObject { put("version", 1) }
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = DashboardLayoutsStore(FakeDashboardLayoutRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<NamedDashboardLayout>>>()
            backgroundScope.launch { store.namedLayouts().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("layout-1", last.data.first().name)
        }

    @Test
    fun sameScopeSharesUpstreamAndDistinctScopesAreDistinctFeeds() =
        runTest {
            val store = DashboardLayoutsStore(FakeDashboardLayoutRepository(), backgroundScope)
            assertSame(store.namedLayouts(), store.namedLayouts())
            assertSame(store.namedLayouts(7), store.namedLayouts(7))
            val global = store.namedLayouts()
            val scoped = store.namedLayouts(7)
            assertTrue(global !== scoped)
        }

    @Test
    fun createDelegatesAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakeDashboardLayoutRepository()
            val store = DashboardLayoutsStore(repo, backgroundScope)
            backgroundScope.launch { store.namedLayouts().collect {} }
            backgroundScope.launch { store.namedLayouts(7).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[dashboardLayoutCacheKey(null)])
            assertEquals(1, repo.collections[dashboardLayoutCacheKey(7)])

            val input = CreateDashboardLayoutInput(name = "New", layout = FakeDashboardLayoutRepository.blob())
            val result = store.createLayout(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.created)
            // invalidate `all`: BOTH observed feeds re-fetch.
            assertEquals(2, repo.collections[dashboardLayoutCacheKey(null)])
            assertEquals(2, repo.collections[dashboardLayoutCacheKey(7)])
        }

    @Test
    fun updateDeleteAndApplyDelegateAndRefreshObservedFeeds() =
        runTest {
            val repo = FakeDashboardLayoutRepository()
            val store = DashboardLayoutsStore(repo, backgroundScope)
            backgroundScope.launch { store.namedLayouts(7).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[dashboardLayoutCacheKey(7)])

            store.updateLayout(UpdateDashboardLayoutInput(id = 5, name = "x"))
            runCurrent()
            assertEquals(listOf(5L), repo.updated.map { it.id })
            assertEquals(2, repo.collections[dashboardLayoutCacheKey(7)])

            store.applyLayout(5)
            runCurrent()
            assertEquals(listOf(5L), repo.applied)
            assertEquals(3, repo.collections[dashboardLayoutCacheKey(7)])

            store.deleteLayout(5)
            runCurrent()
            assertEquals(listOf(5L), repo.deleted)
            assertEquals(4, repo.collections[dashboardLayoutCacheKey(7)])
        }

    @Test
    fun refreshAllIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeDashboardLayoutRepository()
            val store = DashboardLayoutsStore(repo, backgroundScope)

            val result = store.applyLayout(1)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.applied.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
