package io.teslasync.shared.core.presentation.annotations

import io.teslasync.shared.core.data.repo.AnnotationRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.annotationCacheKey
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
 * Verifies the S8 [AnnotationsStore] folds the S7 [AnnotationRepository] into shared,
 * refreshable feeds, derives the as-data view off the SAME upstream, and routes each mutation
 * to the right repository call + an invalidate-all refresh — using a fake repository, so no
 * network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnnotationsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per `params` key (so a refresh is
     * observable) and emits Loading→Success with a single deterministic row; every mutation
     * records its argument and succeeds.
     */
    private class FakeAnnotationRepository : AnnotationRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val created: MutableList<CreateAnnotationInput> = mutableListOf()
        val updated: MutableList<UpdateAnnotationInput> = mutableListOf()
        val deleted: MutableList<Long> = mutableListOf()
        var rowFactory: (Long) -> ChartAnnotationRow = { id -> defaultRow(id) }

        override fun chartAnnotations(params: AnnotationListParams): Flow<Resource<List<ChartAnnotationRow>>> =
            flow {
                val key = annotationCacheKey(params)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(rowFactory(n.toLong())), fetchedAt = 1L, stale = false))
            }

        override suspend fun createAnnotation(input: CreateAnnotationInput): Result<ChartAnnotationRow> {
            created += input
            return Result.success(defaultRow(1))
        }

        override suspend fun updateAnnotation(input: UpdateAnnotationInput): Result<ChartAnnotationRow> {
            updated += input
            return Result.success(defaultRow(input.id))
        }

        override suspend fun deleteAnnotation(id: Long): Result<Unit> {
            deleted += id
            return Result.success(Unit)
        }

        companion object {
            fun defaultRow(id: Long): ChartAnnotationRow =
                ChartAnnotationRow(
                    id = id,
                    vehicleId = 7,
                    occurredAt = "2026-01-01T00:00:00Z",
                    category = "maintenance",
                    title = "row-$id",
                    scope = listOf("tire", "cost"),
                    createdAt = "2026-01-01T00:00:00Z",
                    updatedAt = "2026-01-01T00:00:00Z",
                )
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AnnotationsStore(FakeAnnotationRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<ChartAnnotationRow>>>()
            backgroundScope.launch { store.chartAnnotations().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("row-1", last.data.first().title)
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = AnnotationsStore(FakeAnnotationRepository(), backgroundScope)
            assertSame(store.chartAnnotations(), store.chartAnnotations())
            val byVehicle = store.chartAnnotations(AnnotationListParams(vehicleId = 7))
            val byScope = store.chartAnnotations(AnnotationListParams(scope = "cost"))
            assertTrue(byVehicle !== byScope)
        }

    @Test
    fun asDataProjectsRowsAndReusesTheSameUpstream() =
        runTest {
            val repo = FakeAnnotationRepository()
            val store = AnnotationsStore(repo, backgroundScope)
            val params = AnnotationListParams(vehicleId = 7)

            // Open BOTH the raw and the as-data view of the same params.
            backgroundScope.launch { store.chartAnnotations(params).collect {} }
            val seen = mutableListOf<Resource<List<DataAnnotation>>>()
            backgroundScope.launch { store.chartAnnotationsAsData(params).collect { seen += it } }
            runCurrent()

            // A single underlying fetch backs both views (web reuses the same query key).
            assertEquals(1, repo.collections[annotationCacheKey(params)])

            val success = seen.last() as Resource.Success
            val projected = success.data.first()
            // toDataAnnotation: id stringified, context = first scope bucket, label = title.
            assertEquals("1", projected.id)
            assertEquals("tire", projected.context)
            assertEquals("row-1", projected.label)
            assertEquals(7L, projected.vehicleId)
        }

    @Test
    fun createDelegatesAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakeAnnotationRepository()
            val store = AnnotationsStore(repo, backgroundScope)
            val a = AnnotationListParams(vehicleId = 7)
            val b = AnnotationListParams(scope = "cost")
            backgroundScope.launch { store.chartAnnotations(a).collect {} }
            backgroundScope.launch { store.chartAnnotations(b).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[annotationCacheKey(a)])
            assertEquals(1, repo.collections[annotationCacheKey(b)])

            val input =
                CreateAnnotationInput(occurredAt = "2026-06-15T00:00:00Z", category = "custom", title = "Note")
            val result = store.createAnnotation(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.created)
            // invalidate `all`: BOTH observed feeds re-fetch.
            assertEquals(2, repo.collections[annotationCacheKey(a)])
            assertEquals(2, repo.collections[annotationCacheKey(b)])
        }

    @Test
    fun updateAndDeleteDelegateAndRefreshObservedFeeds() =
        runTest {
            val repo = FakeAnnotationRepository()
            val store = AnnotationsStore(repo, backgroundScope)
            val params = AnnotationListParams()
            backgroundScope.launch { store.chartAnnotations(params).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[annotationCacheKey(params)])

            store.updateAnnotation(UpdateAnnotationInput(id = 5, title = "x"))
            runCurrent()
            assertEquals(listOf(5L), repo.updated.map { it.id })
            assertEquals(2, repo.collections[annotationCacheKey(params)])

            store.deleteAnnotation(5)
            runCurrent()
            assertEquals(listOf(5L), repo.deleted)
            assertEquals(3, repo.collections[annotationCacheKey(params)])
        }

    @Test
    fun asDataFeedAlsoRefreshesAfterAMutation() =
        runTest {
            val repo = FakeAnnotationRepository()
            val store = AnnotationsStore(repo, backgroundScope)
            val params = AnnotationListParams(vehicleId = 7)
            val seen = mutableListOf<Resource<List<DataAnnotation>>>()
            backgroundScope.launch { store.chartAnnotationsAsData(params).collect { seen += it } }
            runCurrent()
            assertEquals("1", (seen.last() as Resource.Success).data.first().id)

            store.deleteAnnotation(99)
            runCurrent()

            // The derived view re-projected the refreshed upstream (row id advanced to 2).
            assertEquals("2", (seen.last() as Resource.Success).data.first().id)
        }

    @Test
    fun refreshAllIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeAnnotationRepository()
            val store = AnnotationsStore(repo, backgroundScope)

            val result =
                store.createAnnotation(
                    CreateAnnotationInput(occurredAt = "2026-06-15T00:00:00Z", category = "custom", title = "Note"),
                )
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.created.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
