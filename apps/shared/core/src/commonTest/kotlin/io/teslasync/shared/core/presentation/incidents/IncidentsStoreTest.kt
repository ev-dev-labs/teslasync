package io.teslasync.shared.core.presentation.incidents

import io.teslasync.shared.core.data.repo.IncidentRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.incidentDetailCacheKey
import io.teslasync.shared.core.data.repo.incidentListCacheKey
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
 * Verifies the S8 [IncidentsStore] folds the S7 [IncidentRepository] into shared, refreshable
 * list + detail feeds, reproduces the web `useIncident` `enabled: id != null` gate, and routes each
 * mutation to the right repository call + an invalidate-all refresh — using a fake repository, so
 * no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class IncidentsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per cache key (so a refresh is observable)
     * and emits Loading→Success with a single deterministic row; every mutation records its argument
     * and succeeds.
     */
    private class FakeIncidentRepository : IncidentRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val created: MutableList<CreateIncidentInput> = mutableListOf()
        val patched: MutableList<PatchIncidentInput> = mutableListOf()
        val appended: MutableList<AppendIncidentUpdateInput> = mutableListOf()
        val deleted: MutableList<Long> = mutableListOf()

        override fun incidents(params: ListIncidentsParams): Flow<Resource<IncidentListResponse>> =
            flow {
                val key = incidentListCacheKey(params)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data = IncidentListResponse(incidents = listOf(incident(n.toLong(), "list-$n")), count = n),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override fun incident(id: Long): Flow<Resource<Incident>> =
            flow {
                val key = incidentDetailCacheKey(id)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = incident(id, "detail-$n"), fetchedAt = 1L, stale = false))
            }

        override suspend fun createIncident(input: CreateIncidentInput): Result<Incident> {
            created += input
            return Result.success(incident(1, input.title))
        }

        override suspend fun patchIncident(input: PatchIncidentInput): Result<Incident> {
            patched += input
            return Result.success(incident(input.id, "patched"))
        }

        override suspend fun appendIncidentUpdate(input: AppendIncidentUpdateInput): Result<Incident> {
            appended += input
            return Result.success(incident(input.id, "appended"))
        }

        override suspend fun deleteIncident(id: Long): Result<Unit> {
            deleted += id
            return Result.success(Unit)
        }

        companion object {
            fun incident(
                id: Long,
                title: String,
            ): Incident =
                Incident(
                    id = id,
                    title = title,
                    description = "desc",
                    severity = "minor",
                    status = "investigating",
                    source = "manual",
                    affectedComponents = listOf("api"),
                    updates = emptyList(),
                    startedAt = "2026-01-01T00:00:00Z",
                    createdAt = "2026-01-01T00:00:00Z",
                    updatedAt = "2026-01-01T00:00:00Z",
                )
        }
    }

    @Test
    fun listReadEmitsCacheThenNetwork() =
        runTest {
            val store = IncidentsStore(FakeIncidentRepository(), backgroundScope)
            val seen = mutableListOf<Resource<IncidentListResponse>>()
            backgroundScope.launch { store.incidents().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            val firstIncident = last.data.incidents.first()
            assertEquals("list-1", firstIncident.title)
            assertEquals(1, last.data.count)
        }

    @Test
    fun detailReadEmitsCacheThenNetwork() =
        runTest {
            val store = IncidentsStore(FakeIncidentRepository(), backgroundScope)
            val seen = mutableListOf<Resource<Incident>>()
            backgroundScope.launch { store.incident(42).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last() as Resource.Success
            assertEquals(42L, last.data.id)
            assertEquals("detail-1", last.data.title)
        }

    @Test
    fun detailIsDisabledAndNeverFetchesWhenIdIsNull() =
        runTest {
            val repo = FakeIncidentRepository()
            val store = IncidentsStore(repo, backgroundScope)

            // A null id collapses to one stable disabled feed (web `enabled: id != null`).
            assertSame(store.incident(null), store.incident(null))
            val seen = mutableListOf<Resource<Incident>>()
            backgroundScope.launch { store.incident(null).collect { seen += it } }
            runCurrent()

            assertTrue(seen.last() is Resource.Loading, "disabled feed stays at the Loading slot")
            assertTrue(repo.collections.isEmpty(), "a disabled detail feed never hits the repository")
        }

    @Test
    fun sameKeysShareUpstreamAndDistinctKeysAreDistinctFeeds() =
        runTest {
            val store = IncidentsStore(FakeIncidentRepository(), backgroundScope)
            assertSame(store.incidents(), store.incidents())
            assertSame(store.incident(7), store.incident(7))

            val activeOnly = store.incidents(ListIncidentsParams(activeOnly = true))
            val all = store.incidents(ListIncidentsParams())
            assertTrue(activeOnly !== all)
            assertTrue(store.incident(7) !== store.incident(8))
        }

    @Test
    fun createDelegatesAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakeIncidentRepository()
            val store = IncidentsStore(repo, backgroundScope)
            val listParams = ListIncidentsParams(activeOnly = true)
            backgroundScope.launch { store.incidents(listParams).collect {} }
            backgroundScope.launch { store.incident(9).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[incidentListCacheKey(listParams)])
            assertEquals(1, repo.collections[incidentDetailCacheKey(9)])

            val input = CreateIncidentInput(title = "Outage", severity = "major")
            val result = store.createIncident(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.created)
            // invalidate `['status-incidents']`: BOTH the list and the detail feed re-fetch.
            assertEquals(2, repo.collections[incidentListCacheKey(listParams)])
            assertEquals(2, repo.collections[incidentDetailCacheKey(9)])
        }

    @Test
    fun patchAppendAndDeleteDelegateAndRefreshObservedFeeds() =
        runTest {
            val repo = FakeIncidentRepository()
            val store = IncidentsStore(repo, backgroundScope)
            val params = ListIncidentsParams()
            backgroundScope.launch { store.incidents(params).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[incidentListCacheKey(params)])

            store.patchIncident(PatchIncidentInput(id = 5, status = "resolved", resolved = true))
            runCurrent()
            assertEquals(listOf(5L), repo.patched.map { it.id })
            assertEquals(2, repo.collections[incidentListCacheKey(params)])

            store.appendIncidentUpdate(AppendIncidentUpdateInput(id = 5, message = "mitigated"))
            runCurrent()
            assertEquals(listOf(5L), repo.appended.map { it.id })
            assertEquals(3, repo.collections[incidentListCacheKey(params)])

            store.deleteIncident(5)
            runCurrent()
            assertEquals(listOf(5L), repo.deleted)
            assertEquals(4, repo.collections[incidentListCacheKey(params)])
        }

    @Test
    fun detailFeedAlsoRefreshesAfterAMutation() =
        runTest {
            val repo = FakeIncidentRepository()
            val store = IncidentsStore(repo, backgroundScope)
            val seen = mutableListOf<Resource<Incident>>()
            backgroundScope.launch { store.incident(3).collect { seen += it } }
            runCurrent()
            assertEquals("detail-1", (seen.last() as Resource.Success).data.title)

            store.deleteIncident(99)
            runCurrent()

            // The detail feed re-fetched the refreshed upstream (collection count advanced to 2).
            assertEquals("detail-2", (seen.last() as Resource.Success).data.title)
        }

    @Test
    fun refreshAllIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeIncidentRepository()
            val store = IncidentsStore(repo, backgroundScope)

            val result = store.createIncident(CreateIncidentInput(title = "Lonely"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.created.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
