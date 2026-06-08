package io.teslasync.shared.core.presentation.operatorconfidence

import io.teslasync.shared.core.data.repo.OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY
import io.teslasync.shared.core.data.repo.OperatorConfidenceRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.auditLogKey
import io.teslasync.shared.core.data.repo.slowQueriesKey
import io.teslasync.shared.core.data.repo.vehicleCostKey
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
 * Verifies the S8 [OperatorConfidenceStore] folds the S7 [OperatorConfidenceRepository] into
 * per-key shared, refreshable feeds — using a fake repository, so no network or cache is involved.
 * Mirrors the web `useOperatorConfidence` hook domain: ten parameterized/fixed reads, no mutations.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OperatorConfidenceStoreTest {
    /**
     * Fake S7 port: counts collections per logical feed key (so a refresh is observable) and emits
     * Loading→Success for each read. The success payload is a minimal DTO; the per-key collection
     * count is stamped where a numeric field exists so a refresh is assertable end-to-end.
     */
    private class FakeOperatorConfidenceRepository : OperatorConfidenceRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        private fun bump(key: String): Int {
            val n = (collections[key] ?: 0) + 1
            collections[key] = n
            return n
        }

        private fun <T> read(
            key: String,
            value: (Int) -> T,
        ): Flow<Resource<T>> =
            flow {
                val n = bump(key)
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value(n), fetchedAt = 1L, stale = false))
            }

        override fun schemaDrift(): Flow<Resource<SchemaDriftResponse>> =
            read(OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY) { SchemaDriftResponse(isDifferent = it > 1) }

        override fun slowQueries(
            orderBy: SlowQueryOrderBy,
            limit: Int,
        ): Flow<Resource<SlowQueriesResponse>> = read(slowQueriesKey(orderBy, limit)) { SlowQueriesResponse(orderBy = orderBy.wire) }

        override fun vehicleCost(
            sinceIso: String?,
            limit: Int,
        ): Flow<Resource<VehicleCostResponse>> =
            read(vehicleCostKey(sinceIso, limit)) {
                VehicleCostResponse(totals = VehicleCostTotals(totalRows = it.toLong()))
            }

        override fun diskForecast(): Flow<Resource<DiskForecastResponse>> = read("disk-forecast") { DiskForecastResponse() }

        override fun secretRotation(): Flow<Resource<SecretRotationResponse>> = read("secret-rotation") { SecretRotationResponse() }

        override fun auditLog(params: AuditLogQueryParams): Flow<Resource<AuditLogListResponse>> =
            read(auditLogKey(params)) { AuditLogListResponse(limit = it.toLong()) }

        override fun auditCategories(): Flow<Resource<AuditCategoriesResponse>> = read("audit-categories") { AuditCategoriesResponse() }

        override fun auditActions(): Flow<Resource<AuditActionsResponse>> = read("audit-actions") { AuditActionsResponse() }

        override fun auditChainVerify(
            sinceIso: String?,
            limit: Int,
        ): Flow<Resource<AuditChainVerifyResponse>> = read("audit-verify:$sinceIso:$limit") { AuditChainVerifyResponse(intact = true) }

        override fun gdprExport(id: String): Flow<Resource<GDPRExportArtifact>> = read("gdpr:$id") { GDPRExportArtifact(id = id) }
    }

    @Test
    fun everyReadEmitsCacheThenNetwork() =
        runTest {
            val store = OperatorConfidenceStore(FakeOperatorConfidenceRepository(), backgroundScope)
            val feeds: List<StateFlowProbe> =
                listOf(
                    probe("schemaDrift") { store.schemaDrift() },
                    probe("slowQueries") { store.slowQueries() },
                    probe("vehicleCost") { store.vehicleCost() },
                    probe("diskForecast") { store.diskForecast() },
                    probe("secretRotation") { store.secretRotation() },
                    probe("auditLog") { store.auditLog() },
                    probe("auditCategories") { store.auditCategories() },
                    probe("auditActions") { store.auditActions() },
                    probe("auditChainVerify") { store.auditChainVerify() },
                    probe("gdprExport") { store.gdprExport("artifact-1") },
                )
            for (p in feeds) {
                val seen = mutableListOf<Resource<*>>()
                backgroundScope.launch { p.open().collect { seen += it } }
                runCurrent()
                assertTrue(seen.first() is Resource.Loading, "${p.name}: first emission is Loading (cache slot)")
                assertTrue(seen.last() is Resource.Success, "${p.name}: terminal emission is the network Success")
            }
        }

    @Test
    fun sameParamsShareFeedDistinctParamsDoNot() =
        runTest {
            val store = OperatorConfidenceStore(FakeOperatorConfidenceRepository(), backgroundScope)
            assertSame(store.schemaDrift(), store.schemaDrift(), "a fixed read folds into one shared feed")
            assertSame(store.slowQueries(), store.slowQueries(), "same params fold into one shared feed")
            assertNotSame(
                store.slowQueries(),
                store.slowQueries(orderBy = SlowQueryOrderBy.CALLS),
                "a different order_by keys a distinct feed",
            )
            assertNotSame(
                store.vehicleCost(limit = 100),
                store.vehicleCost(limit = 50),
                "a different limit keys a distinct feed",
            )
            assertNotSame(
                store.auditLog(AuditLogQueryParams(actions = listOf("login"))),
                store.auditLog(AuditLogQueryParams(actions = listOf("logout"))),
                "different audit-log filters key distinct feeds",
            )
        }

    @Test
    fun observersOfOneFeedFoldIntoASingleCollection() =
        runTest {
            val repo = FakeOperatorConfidenceRepository()
            val store = OperatorConfidenceStore(repo, backgroundScope)
            backgroundScope.launch { store.schemaDrift().collect {} }
            backgroundScope.launch { store.schemaDrift().collect {} }
            runCurrent()

            assertEquals(1, repo.collections[OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY], "two observers ⇒ one upstream collection")
        }

    @Test
    fun refreshReFetchesOnlyTheMatchingFeed() =
        runTest {
            val repo = FakeOperatorConfidenceRepository()
            val store = OperatorConfidenceStore(repo, backgroundScope)
            val schemaKey = OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY
            val slowKey = slowQueriesKey(SlowQueryOrderBy.MEAN_TIME, 25)
            backgroundScope.launch { store.schemaDrift().collect {} }
            backgroundScope.launch { store.slowQueries().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[schemaKey])
            assertEquals(1, repo.collections[slowKey])

            store.refreshSchemaDrift()
            runCurrent()

            assertEquals(2, repo.collections[schemaKey], "the schema-drift feed was refreshed")
            assertEquals(1, repo.collections[slowKey], "the slow-queries feed was left untouched")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeOperatorConfidenceRepository()
            val store = OperatorConfidenceStore(repo, backgroundScope)

            store.refreshSchemaDrift()
            store.refreshGdprExport("artifact-1")
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no observer ⇒ no upstream restart")
        }

    // ---- helpers ------------------------------------------------------------------

    private class StateFlowProbe(
        val name: String,
        val open: () -> Flow<Resource<*>>,
    )

    private fun probe(
        name: String,
        open: () -> Flow<Resource<*>>,
    ): StateFlowProbe = StateFlowProbe(name, open)
}
