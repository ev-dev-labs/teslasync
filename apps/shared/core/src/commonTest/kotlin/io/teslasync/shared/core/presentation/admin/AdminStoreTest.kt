package io.teslasync.shared.core.presentation.admin

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [AdminStore] folds the S7 [AdminRepository] into shared, refreshable
 * feeds and routes each mutation to the right repository call + refresh — using a fake
 * repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AdminStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections (so a refresh is observable) and
     * emits Loading→Success; every mutation records its arguments and succeeds.
     */
    private class FakeAdminRepository : AdminRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val createdKeys: MutableList<Pair<String, String>> = mutableListOf()
        val deleted: MutableList<String> = mutableListOf()
        val revoked: MutableList<String> = mutableListOf()
        val maintenance: MutableList<MaintenanceUpdateInput> = mutableListOf()
        val exports: MutableList<Triple<String, String, String?>> = mutableListOf()

        private fun feed(label: String): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }

        override fun apiKeys(): Flow<Resource<JsonElement>> = feed("api-keys")

        override fun apiLogs(page: Int): Flow<Resource<JsonElement>> = feed("api-logs:$page")

        override fun apiLogStats(): Flow<Resource<JsonElement>> = feed("api-log-stats")

        override fun backupConfigs(): Flow<Resource<JsonElement>> = feed("backup-configs")

        override fun backupRuns(): Flow<Resource<JsonElement>> = feed("backup-runs")

        override fun systemHealth(): Flow<Resource<JsonElement>> = feed("system-health")

        override fun maintenanceState(): Flow<Resource<JsonElement>> = feed("maintenance")

        override fun auditLogs(): Flow<Resource<JsonElement>> = feed("audit-logs")

        override fun webErrorsSummary(): Flow<Resource<JsonElement>> = feed("web-errors-summary")

        override fun securityEvents(vehicleId: String): Flow<Resource<JsonElement>> = feed("security-events:$vehicleId")

        override fun dbStats(): Flow<Resource<JsonElement>> = feed("db-stats")

        override fun migrations(): Flow<Resource<JsonElement>> = feed("migrations")

        override fun connectionPool(): Flow<Resource<JsonElement>> = feed("connection-pool")

        override fun exportJobs(): Flow<Resource<JsonElement>> = feed("export-jobs")

        override fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>> = feed("vehicle-state:$vehicleId")

        override fun stateTimeline(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = feed("state-timeline:$vehicleId:$days")

        override suspend fun createApiKey(
            name: String,
            permissions: String,
        ): Result<JsonElement> {
            createdKeys += name to permissions
            return Result.success(JsonPrimitive("created"))
        }

        override suspend fun deleteApiKey(id: String): Result<Unit> {
            deleted += id
            return Result.success(Unit)
        }

        override suspend fun revokeApiKey(id: String): Result<Unit> {
            revoked += id
            return Result.success(Unit)
        }

        override suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<JsonElement> {
            maintenance += input
            return Result.success(JsonPrimitive("maintenance"))
        }

        override suspend fun createExport(
            type: String,
            format: String,
            vehicleId: String?,
        ): Result<JsonElement> {
            exports += Triple(type, format, vehicleId)
            return Result.success(JsonPrimitive("export"))
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AdminStore(FakeAdminRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.apiLogStats().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("api-log-stats#1", last.data.toString().trim('"'))
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = AdminStore(FakeAdminRepository(), backgroundScope)
            assertSame(store.apiKeys(), store.apiKeys())
            // Distinct parameters are distinct feeds.
            assertTrue(store.apiLogs(1) !== store.apiLogs(2))
        }

    @Test
    fun createApiKeyDelegatesAndRefreshesApiKeysFeed() =
        runTest {
            val repo = FakeAdminRepository()
            val store = AdminStore(repo, backgroundScope)
            backgroundScope.launch { store.apiKeys().collect {} }
            runCurrent()
            assertEquals(1, repo.collections["api-keys"])

            val result = store.createApiKey("ci", "read")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("ci" to "read"), repo.createdKeys)
            assertEquals(2, repo.collections["api-keys"], "successful mutation refreshes the feed")
        }

    @Test
    fun deleteAndRevokeDelegateAndRefreshApiKeysFeed() =
        runTest {
            val repo = FakeAdminRepository()
            val store = AdminStore(repo, backgroundScope)
            backgroundScope.launch { store.apiKeys().collect {} }
            runCurrent()

            store.deleteApiKey("k1")
            runCurrent()
            assertEquals(listOf("k1"), repo.deleted)
            assertEquals(2, repo.collections["api-keys"])

            store.revokeApiKey("k2")
            runCurrent()
            assertEquals(listOf("k2"), repo.revoked)
            assertEquals(3, repo.collections["api-keys"])
        }

    @Test
    fun updateMaintenanceRefreshesMaintenanceAndSystemHealth() =
        runTest {
            val repo = FakeAdminRepository()
            val store = AdminStore(repo, backgroundScope)
            backgroundScope.launch { store.maintenanceState().collect {} }
            backgroundScope.launch { store.systemHealth().collect {} }
            runCurrent()
            assertEquals(1, repo.collections["maintenance"])
            assertEquals(1, repo.collections["system-health"])

            val input = MaintenanceUpdateInput(mode = "maintenance", message = "upgrade", until = null)
            val result = store.updateMaintenance(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.maintenance)
            assertEquals(2, repo.collections["maintenance"])
            assertEquals(2, repo.collections["system-health"])
        }

    @Test
    fun createExportDelegatesAndRefreshesExportJobs() =
        runTest {
            val repo = FakeAdminRepository()
            val store = AdminStore(repo, backgroundScope)
            backgroundScope.launch { store.exportJobs().collect {} }
            runCurrent()
            assertEquals(1, repo.collections["export-jobs"])

            store.createExport("drives", "csv", vehicleId = "7")
            runCurrent()

            assertEquals(listOf(Triple<String, String, String?>("drives", "csv", "7")), repo.exports)
            assertEquals(2, repo.collections["export-jobs"])
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeAdminRepository()
            val store = AdminStore(repo, backgroundScope)

            // No one is observing api-keys; the mutation still succeeds and is recorded,
            // and nothing is collected (no stale upstream restarted needlessly).
            val result = store.createApiKey("ci", "read")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("ci" to "read"), repo.createdKeys)
            assertEquals(null, repo.collections["api-keys"])
        }

    @Test
    fun parameterizedReadsTargetTheirOwnKeys() =
        runTest {
            val repo = FakeAdminRepository()
            val store = AdminStore(repo, backgroundScope)
            backgroundScope.launch { store.securityEvents("9").collect {} }
            backgroundScope.launch { store.stateTimeline("9", days = 30).collect {} }
            backgroundScope.launch { store.vehicleStateMachine("9").collect {} }
            runCurrent()

            assertEquals(1, repo.collections["security-events:9"])
            assertEquals(1, repo.collections["state-timeline:9:30"])
            assertEquals(1, repo.collections["vehicle-state:9"])
        }
}
