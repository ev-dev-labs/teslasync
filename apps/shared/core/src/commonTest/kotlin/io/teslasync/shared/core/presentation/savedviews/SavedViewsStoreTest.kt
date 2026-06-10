package io.teslasync.shared.core.presentation.savedviews

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SavedViewRepository
import io.teslasync.shared.core.data.repo.savedViewCacheKey
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
 * Verifies the S8 [SavedViewsStore] folds the S7 [SavedViewRepository] into shared, refreshable
 * per-route feeds and routes each mutation to the right repository call + the web-faithful invalidate
 * granularity (every mutation refreshes ONLY the affected route's feed — `savedViewsKeys.list(route)`,
 * never the whole `all` prefix) — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SavedViewsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per `route` key (so a refresh is observable)
     * and emits Loading→Success with a single deterministic row; every mutation records its arguments
     * and succeeds (configurably).
     */
    private class FakeSavedViewRepository : SavedViewRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val created: MutableList<SavedViewCreateInput> = mutableListOf()
        val updated: MutableList<Triple<Long, String, SavedViewUpdateInput>> = mutableListOf()
        val deleted: MutableList<Pair<Long, String>> = mutableListOf()
        val setDefaults: MutableList<Triple<Long, String, Boolean>> = mutableListOf()
        var createResult: (SavedViewCreateInput) -> Result<SavedView> = { Result.success(row(1, it.route)) }
        var mutationSucceeds = true

        override fun savedViews(route: String): Flow<Resource<List<SavedView>>> =
            flow {
                val key = savedViewCacheKey(route)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(row(n.toLong(), route)), fetchedAt = 1L, stale = false))
            }

        override suspend fun createSavedView(input: SavedViewCreateInput): Result<SavedView> {
            created += input
            return if (mutationSucceeds) createResult(input) else FAILURE
        }

        override suspend fun updateSavedView(
            id: Long,
            route: String,
            patch: SavedViewUpdateInput,
        ): Result<SavedView> {
            updated += Triple(id, route, patch)
            return if (mutationSucceeds) Result.success(row(id, route)) else FAILURE
        }

        override suspend fun deleteSavedView(
            id: Long,
            route: String,
        ): Result<Unit> {
            deleted += id to route
            return if (mutationSucceeds) Result.success(Unit) else Result.failure(IllegalStateException("500"))
        }

        override suspend fun setDefaultSavedView(
            id: Long,
            route: String,
            isDefault: Boolean,
        ): Result<SavedView> {
            setDefaults += Triple(id, route, isDefault)
            return if (mutationSucceeds) Result.success(row(id, route, isDefault)) else FAILURE
        }

        companion object {
            val FAILURE: Result<SavedView> = Result.failure(IllegalStateException("500"))

            fun row(
                id: Long,
                route: String,
                isDefault: Boolean = false,
            ): SavedView =
                SavedView(
                    id = id,
                    userId = 3,
                    name = "view-$id",
                    route = route,
                    query = "from=2025-04-24&sort=distance",
                    isDefault = isDefault,
                    isPinned = false,
                    sortOrder = 0,
                    createdAt = "2026-01-01T00:00:00Z",
                    updatedAt = "2026-01-01T00:00:00Z",
                )

            fun create(route: String = "/drives"): SavedViewCreateInput = SavedViewCreateInput(name = "New", route = route, query = "q=1")
        }
    }

    // ---- Read ---------------------------------------------------------------------

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = SavedViewsStore(FakeSavedViewRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<SavedView>>>()
            backgroundScope.launch { store.savedViews("/drives").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("/drives", last.data.first().route)
            assertEquals("view-1", last.data.first().name)
        }

    @Test
    fun sameRouteSharesUpstreamAndDistinctRoutesAreDistinctFeeds() =
        runTest {
            val store = SavedViewsStore(FakeSavedViewRepository(), backgroundScope)
            assertSame(store.savedViews("/drives"), store.savedViews("/drives"))
            assertSame(store.savedViews("/charging"), store.savedViews("/charging"))
            assertTrue(store.savedViews("/drives") !== store.savedViews("/charging"))
        }

    // ---- Mutations ----------------------------------------------------------------

    @Test
    fun createDelegatesAndRefreshesOnlyTheCreatedRoute() =
        runTest {
            val repo = FakeSavedViewRepository()
            val store = SavedViewsStore(repo, backgroundScope)
            backgroundScope.launch { store.savedViews("/drives").collect {} }
            backgroundScope.launch { store.savedViews("/charging").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[savedViewCacheKey("/drives")])
            assertEquals(1, repo.collections[savedViewCacheKey("/charging")])

            val input = FakeSavedViewRepository.create(route = "/drives")
            val result = store.createSavedView(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.created)
            // Web invalidates ONLY savedViewsKeys.list(created.route): /drives re-fetches, /charging untouched.
            assertEquals(2, repo.collections[savedViewCacheKey("/drives")])
            assertEquals(1, repo.collections[savedViewCacheKey("/charging")])
        }

    @Test
    fun updateDelegatesAndRefreshesOnlyTheSuppliedRoute() =
        runTest {
            val repo = FakeSavedViewRepository()
            val store = SavedViewsStore(repo, backgroundScope)
            backgroundScope.launch { store.savedViews("/drives").collect {} }
            backgroundScope.launch { store.savedViews("/charging").collect {} }
            runCurrent()

            val result =
                store.updateSavedView(
                    UpdateSavedViewArgs(id = 5, route = "/drives", patch = SavedViewUpdateInput(name = "Renamed")),
                )
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple(5L, "/drives", SavedViewUpdateInput(name = "Renamed"))), repo.updated)
            assertEquals(2, repo.collections[savedViewCacheKey("/drives")])
            assertEquals(1, repo.collections[savedViewCacheKey("/charging")])
        }

    @Test
    fun deleteDelegatesAndRefreshesOnlyTheSuppliedRoute() =
        runTest {
            val repo = FakeSavedViewRepository()
            val store = SavedViewsStore(repo, backgroundScope)
            backgroundScope.launch { store.savedViews("/drives").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[savedViewCacheKey("/drives")])

            val result = store.deleteSavedView(DeleteSavedViewArgs(id = 9, route = "/drives"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(9L to "/drives"), repo.deleted)
            assertEquals(2, repo.collections[savedViewCacheKey("/drives")])
        }

    @Test
    fun setDefaultDelegatesAndRefreshesOnlyTheSuppliedRoute() =
        runTest {
            val repo = FakeSavedViewRepository()
            val store = SavedViewsStore(repo, backgroundScope)
            backgroundScope.launch { store.savedViews("/drives").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[savedViewCacheKey("/drives")])

            val result = store.setDefaultSavedView(SetDefaultSavedViewArgs(id = 5, route = "/drives", isDefault = true))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple(5L, "/drives", true)), repo.setDefaults)
            assertEquals(2, repo.collections[savedViewCacheKey("/drives")])
        }

    @Test
    fun failedMutationDoesNotRefresh() =
        runTest {
            val repo = FakeSavedViewRepository()
            repo.mutationSucceeds = false
            val store = SavedViewsStore(repo, backgroundScope)
            backgroundScope.launch { store.savedViews("/drives").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[savedViewCacheKey("/drives")])

            val result = store.deleteSavedView(DeleteSavedViewArgs(id = 9, route = "/drives"))
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.collections[savedViewCacheKey("/drives")], "onError ⇒ no invalidation")
        }

    @Test
    fun refreshIsNoOpWhenRouteNotObserved() =
        runTest {
            val repo = FakeSavedViewRepository()
            val store = SavedViewsStore(repo, backgroundScope)

            val result = store.createSavedView(FakeSavedViewRepository.create(route = "/drives"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.created.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
