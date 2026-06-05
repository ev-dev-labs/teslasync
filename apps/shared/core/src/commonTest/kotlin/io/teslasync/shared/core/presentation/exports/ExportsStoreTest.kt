package io.teslasync.shared.core.presentation.exports

import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.exportColumnsKey
import io.teslasync.shared.core.data.repo.exportDetailKey
import io.teslasync.shared.core.data.repo.exportJobKey
import io.teslasync.shared.core.data.repo.exportJobsKey
import io.teslasync.shared.core.data.repo.exportsAllKey
import io.teslasync.shared.core.data.repo.scheduledExportsKey
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
 * Verifies the S8 [ExportsStore] folds the S7 [ExportsRepository] into shared, refreshable typed
 * feeds and routes each mutation to the right repository call + the web-faithful targeted refresh
 * (the `invalidateQueries` prefix) — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ExportsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per feed key (so a refresh is
     * observable) and emits Loading→Success with a deterministic value carrying the collection
     * count; every mutation records its argument and succeeds.
     */
    private class FakeExportsRepository : ExportsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val createdExports: MutableList<CreateExportPayload> = mutableListOf()
        val createdAccount: MutableList<CreateAccountExportPayload> = mutableListOf()
        val bulkDeleted: MutableList<List<String>> = mutableListOf()
        val createdSchedules: MutableList<ScheduledExportInput> = mutableListOf()
        val updatedSchedules: MutableList<Pair<Long, ScheduledExportInput>> = mutableListOf()
        val deletedSchedules: MutableList<Long> = mutableListOf()
        val ranSchedules: MutableList<Long> = mutableListOf()

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

        override fun exports(): Flow<Resource<List<ExportJob>>> = counting(exportsAllKey()) { n -> listOf(ExportJob(id = "e-$n")) }

        override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> =
            counting(exportJobsKey()) { n -> listOf(ExportJobSummary(id = "j-$n")) }

        override fun exportJob(id: String): Flow<Resource<ExportJobSummary>> =
            counting(exportJobKey(id)) { n -> ExportJobSummary(id = id, status = "ready-$n") }

        override fun export(id: String): Flow<Resource<ExportJob>> =
            counting(exportDetailKey(id)) { n -> ExportJob(id = id, format = "csv-$n") }

        override fun exportColumns(type: String): Flow<Resource<ExportColumnsResponse>> =
            counting(exportColumnsKey(type)) { _ -> ExportColumnsResponse(type = type) }

        override fun scheduledExports(): Flow<Resource<List<ScheduledExport>>> =
            counting(scheduledExportsKey()) { n -> listOf(ScheduledExport(id = n.toLong())) }

        override suspend fun createExport(payload: CreateExportPayload): Result<ExportJobSummary> {
            createdExports += payload
            return Result.success(ExportJobSummary(id = "new"))
        }

        override suspend fun createAccountExport(payload: CreateAccountExportPayload): Result<ExportJobSummary> {
            createdAccount += payload
            return Result.success(ExportJobSummary(id = "acct"))
        }

        override suspend fun bulkExportsDelete(ids: List<String>): Result<ExportBulkResult> {
            bulkDeleted += ids
            return Result.success(ExportBulkResult(deleted = ids.size))
        }

        override suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport> {
            createdSchedules += input
            return Result.success(ScheduledExport(id = 1))
        }

        override suspend fun updateScheduledExport(
            id: Long,
            input: ScheduledExportInput,
        ): Result<ScheduledExport> {
            updatedSchedules += id to input
            return Result.success(ScheduledExport(id = id))
        }

        override suspend fun deleteScheduledExport(id: Long): Result<Unit> {
            deletedSchedules += id
            return Result.success(Unit)
        }

        override suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport> {
            ranSchedules += id
            return Result.success(ScheduledExport(id = id))
        }
    }

    private fun scheduleInput() =
        ScheduledExportInput(
            name = "Nightly",
            exportType = "drives",
            format = "csv",
            scheduleCron = "0 2 * * *",
            delivery = ScheduledExportDelivery(kind = "download"),
        )

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = ExportsStore(FakeExportsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<ExportJobSummary>>>()
            backgroundScope.launch { store.exportJobs().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("j-1", last.data.first().id)
        }

    @Test
    fun sameKeySharesUpstreamAndDistinctKeysAreDistinctFeeds() =
        runTest {
            val store = ExportsStore(FakeExportsRepository(), backgroundScope)
            assertSame(store.exports(), store.exports())
            assertSame(store.exportJobs(), store.exportJobs())
            assertSame(store.exportJob("a"), store.exportJob("a"))
            assertTrue(store.exportJob("a") !== store.exportJob("b"))
            assertTrue(store.export("a") !== store.exportJob("a"))
            assertTrue(store.exportColumns("drives") !== store.exportColumns("charging"))
        }

    @Test
    fun gatedReadsReturnStableDisabledFeedAndNeverFetch() =
        runTest {
            val repo = FakeExportsRepository()
            val store = ExportsStore(repo, backgroundScope)

            assertSame(store.exportJob(null), store.exportJob(""))
            assertSame(store.export(null), store.export(""))
            assertSame(store.exportColumns(null), store.exportColumns(""))

            backgroundScope.launch { store.exportJob(null).collect {} }
            backgroundScope.launch { store.export("").collect {} }
            backgroundScope.launch { store.exportColumns(null).collect {} }
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "disabled feeds must never hit the repository")
            assertTrue(store.exportJob(null).value is Resource.Loading)
        }

    @Test
    fun createExportRefreshesJobAndLegacyExportPrefixesOnly() =
        runTest {
            val repo = FakeExportsRepository()
            val store = ExportsStore(repo, backgroundScope)
            backgroundScope.launch { store.exports().collect {} }
            backgroundScope.launch { store.exportJobs().collect {} }
            backgroundScope.launch { store.exportJob("7").collect {} }
            backgroundScope.launch { store.export("9").collect {} }
            backgroundScope.launch { store.exportColumns("drives").collect {} }
            backgroundScope.launch { store.scheduledExports().collect {} }
            runCurrent()

            val payload = CreateExportPayload(type = "drives")
            val result = store.createExport(payload)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(payload), repo.createdExports)
            // Both `['export-jobs']` (list + single job) AND `['exports']` (legacy list + detail) re-fetch.
            assertEquals(2, repo.collections[exportJobsKey()])
            assertEquals(2, repo.collections[exportJobKey("7")])
            assertEquals(2, repo.collections[exportsAllKey()])
            assertEquals(2, repo.collections[exportDetailKey("9")])
            // Unrelated feeds untouched.
            assertEquals(1, repo.collections[exportColumnsKey("drives")])
            assertEquals(1, repo.collections[scheduledExportsKey()])
        }

    @Test
    fun accountExportAndBulkDeleteRefreshJobLists() =
        runTest {
            val repo = FakeExportsRepository()
            val store = ExportsStore(repo, backgroundScope)
            backgroundScope.launch { store.exports().collect {} }
            backgroundScope.launch { store.exportJobs().collect {} }
            backgroundScope.launch { store.scheduledExports().collect {} }
            runCurrent()

            store.createAccountExport()
            runCurrent()
            assertEquals(1, repo.createdAccount.size)
            assertEquals(2, repo.collections[exportJobsKey()])
            assertEquals(2, repo.collections[exportsAllKey()])
            assertEquals(1, repo.collections[scheduledExportsKey()])

            val result = store.bulkExportsDelete(listOf("a", "b"))
            runCurrent()
            assertTrue(result.isSuccess)
            assertEquals(listOf(listOf("a", "b")), repo.bulkDeleted)
            assertEquals(3, repo.collections[exportJobsKey()])
            assertEquals(3, repo.collections[exportsAllKey()])
            // The schedules feed is never touched by job mutations.
            assertEquals(1, repo.collections[scheduledExportsKey()])
        }

    @Test
    fun scheduledMutationsRefreshOnlyTheSchedulesFeed() =
        runTest {
            val repo = FakeExportsRepository()
            val store = ExportsStore(repo, backgroundScope)
            backgroundScope.launch { store.scheduledExports().collect {} }
            backgroundScope.launch { store.exportJobs().collect {} }
            runCurrent()

            store.createScheduledExport(scheduleInput())
            runCurrent()
            assertEquals(1, repo.createdSchedules.size)
            assertEquals(2, repo.collections[scheduledExportsKey()])

            store.updateScheduledExport(5, scheduleInput())
            runCurrent()
            assertEquals(listOf(5L), repo.updatedSchedules.map { it.first })
            assertEquals(3, repo.collections[scheduledExportsKey()])

            store.runScheduledExportNow(5)
            runCurrent()
            assertEquals(listOf(5L), repo.ranSchedules)
            assertEquals(4, repo.collections[scheduledExportsKey()])

            store.deleteScheduledExport(5)
            runCurrent()
            assertEquals(listOf(5L), repo.deletedSchedules)
            assertEquals(5, repo.collections[scheduledExportsKey()])

            // Job feeds are never refreshed by a scheduled mutation.
            assertEquals(1, repo.collections[exportJobsKey()])
        }

    @Test
    fun refreshIsNoOpWhenNothingObserved() =
        runTest {
            val repo = FakeExportsRepository()
            val store = ExportsStore(repo, backgroundScope)

            val result = store.bulkExportsDelete(listOf("x"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.bulkDeleted.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
            assertNull(repo.collections[exportJobsKey()])
        }
}
