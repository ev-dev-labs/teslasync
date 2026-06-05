package io.teslasync.shared.core.presentation.charging

import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.chargePlansKey
import io.teslasync.shared.core.data.repo.chargingOptimizerKey
import io.teslasync.shared.core.data.repo.chargingPaginatedKey
import io.teslasync.shared.core.data.repo.chargingSessionByIdKey
import io.teslasync.shared.core.data.repo.chargingSessionDetailKey
import io.teslasync.shared.core.data.repo.chargingSessionsKey
import io.teslasync.shared.core.data.repo.ratePlansKey
import io.teslasync.shared.core.data.repo.teslaChargingHistoryKey
import io.teslasync.shared.core.data.repo.teslaChargingSessionsKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Verifies the S8 [ChargingStore] folds the S7 [ChargingRepository] into shared, refreshable
 * feeds and routes each mutation to the right repository call + the EXACT web `invalidateQueries`
 * family — using a fake repository, so no network or cache is involved. Each fake read counts its
 * collections under the same cache key the store observes (computed via the shared key builders),
 * so a refresh is directly observable per feed.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingStoreTest {
    private class FakeChargingRepository : ChargingRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val historyRefreshes: MutableList<Triple<String?, String?, String?>> = mutableListOf()
        val sessionsRefreshes: MutableList<Triple<String?, String?, String?>> = mutableListOf()
        val optimized: MutableList<OptimizeChargeInput> = mutableListOf()
        val applied: MutableList<ApplyScheduleInput> = mutableListOf()
        val bulkDeleted: MutableList<List<Long>> = mutableListOf()

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

        override fun sessions(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
            counting(chargingSessionsKey(vehicleId)) { listOf(session(it.toLong())) }

        override fun session(id: String): Flow<Resource<ChargingSession>> = counting(chargingSessionDetailKey(id)) { session(it.toLong()) }

        override fun sessionDetail(id: Long): Flow<Resource<ChargingSession>> =
            counting(chargingSessionByIdKey(id)) { session(it.toLong()) }

        override fun chargeTelemetry(sessionId: Long): Flow<Resource<List<ChargeTelemetryReading>>> =
            counting(
                io.teslasync.shared.core.data.repo
                    .chargeTelemetryKey(sessionId),
            ) { emptyList() }

        override fun sessionsPaginated(
            vehicleId: Long,
            limit: Int,
            offset: Int,
            start: String?,
            end: String?,
        ): Flow<Resource<List<ChargingSession>>> =
            counting(chargingPaginatedKey(vehicleId, start, end, limit, offset)) { listOf(session(it.toLong())) }

        override fun costForecast(
            vehicleId: String,
            months: Int,
        ): Flow<Resource<JsonElement>> =
            counting(
                io.teslasync.shared.core.data.repo
                    .costForecastKey(vehicleId, months),
            ) { JsonObject(emptyMap()) }

        override fun chargingOptimizer(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(chargingOptimizerKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun teslaChargingHistory(vin: String?): Flow<Resource<JsonElement>> =
            counting(teslaChargingHistoryKey(vin)) { JsonObject(emptyMap()) }

        override fun teslaChargingSessions(vin: String?): Flow<Resource<JsonElement>> =
            counting(teslaChargingSessionsKey(vin)) { JsonObject(emptyMap()) }

        override fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(chargePlansKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun ratePlans(): Flow<Resource<JsonElement>> = counting(ratePlansKey()) { JsonObject(emptyMap()) }

        override suspend fun refreshTeslaChargingHistory(
            vin: String?,
            startTime: String?,
            endTime: String?,
        ): Result<JsonElement> {
            historyRefreshes += Triple(vin, startTime, endTime)
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun refreshTeslaChargingSessions(
            vin: String?,
            dateFrom: String?,
            dateTo: String?,
        ): Result<JsonElement> {
            sessionsRefreshes += Triple(vin, dateFrom, dateTo)
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun optimizeCharge(input: OptimizeChargeInput): Result<JsonElement> {
            optimized += input
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun applySchedule(input: ApplyScheduleInput): Result<JsonElement> {
            applied += input
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun bulkDeleteCharging(ids: List<Long>): Result<JsonElement> {
            bulkDeleted += ids
            return Result.success(JsonObject(emptyMap()))
        }

        companion object {
            fun session(id: Long): ChargingSession =
                ChargingSession(id = id, startedAt = Instant.parse("2026-01-01T00:00:00Z"), vehicleId = 7)
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = ChargingStore(FakeChargingRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<ChargingSession>>>()
            backgroundScope.launch { store.sessions(7).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(1, last.data.size)
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = ChargingStore(FakeChargingRepository(), backgroundScope)
            assertSame(store.sessions(7), store.sessions(7))
            assertTrue(store.sessions(7) !== store.sessions(8))
            // Distinct shapes never collide even when they share the underlying feed map.
            assertTrue(store.sessions(7) !== store.sessionsPaginated(7))
        }

    @Test
    fun bulkDeleteRefreshesSessionsFamilyButNotNumericDetailOrPaginated() =
        runTest {
            val repo = FakeChargingRepository()
            val store = ChargingStore(repo, backgroundScope)
            backgroundScope.launch { store.sessions(7).collect {} }
            backgroundScope.launch { store.session("5").collect {} }
            backgroundScope.launch { store.sessionDetail(9).collect {} }
            backgroundScope.launch { store.sessionsPaginated(7).collect {} }
            runCurrent()

            assertEquals(1, repo.collections[chargingSessionsKey(7)])
            assertEquals(1, repo.collections[chargingSessionDetailKey("5")])
            assertEquals(1, repo.collections[chargingSessionByIdKey(9)])
            assertEquals(1, repo.collections[chargingPaginatedKey(7, null, null, ChargingRepository.DEFAULT_LIMIT, 0)])

            val result = store.bulkDeleteCharging(listOf(1, 2))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(listOf(1L, 2L)), repo.bulkDeleted)
            // ['charging-sessions'] prefix → byVehicle + string-id detail re-fetch …
            assertEquals(2, repo.collections[chargingSessionsKey(7)])
            assertEquals(2, repo.collections[chargingSessionDetailKey("5")])
            // … but NOT the singular ['charging-session'] numeric detail, nor ['charging', …] paginated.
            assertEquals(1, repo.collections[chargingSessionByIdKey(9)])
            assertEquals(1, repo.collections[chargingPaginatedKey(7, null, null, ChargingRepository.DEFAULT_LIMIT, 0)])
        }

    @Test
    fun applyScheduleRefreshesChargePlansButNotRatePlans() =
        runTest {
            val repo = FakeChargingRepository()
            val store = ChargingStore(repo, backgroundScope)
            backgroundScope.launch { store.chargePlans(7).collect {} }
            backgroundScope.launch { store.ratePlans().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[chargePlansKey(7)])
            assertEquals(1, repo.collections[ratePlansKey()])

            val result = store.applySchedule(ApplyScheduleInput(planId = 42))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(42L), repo.applied.map { it.planId })
            assertEquals(2, repo.collections[chargePlansKey(7)])
            // rate-plans key is a sibling, not a descendant of ['charge-plans'] → untouched.
            assertEquals(1, repo.collections[ratePlansKey()])
        }

    @Test
    fun teslaHistoryRefreshFansAcrossHistoryFamilyOnly() =
        runTest {
            val repo = FakeChargingRepository()
            val store = ChargingStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaChargingHistory().collect {} }
            backgroundScope.launch { store.teslaChargingHistory("VIN1").collect {} }
            backgroundScope.launch { store.teslaChargingSessions().collect {} }
            runCurrent()

            val result = store.refreshTeslaChargingHistory(vin = "VIN1", startTime = "2026-01-01")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple<String?, String?, String?>("VIN1", "2026-01-01", null)), repo.historyRefreshes)
            // Both the all-key and the by-vin history feeds re-fetch …
            assertEquals(2, repo.collections[teslaChargingHistoryKey(null)])
            assertEquals(2, repo.collections[teslaChargingHistoryKey("VIN1")])
            // … the sibling tesla-sessions family is left alone.
            assertEquals(1, repo.collections[teslaChargingSessionsKey(null)])
        }

    @Test
    fun teslaSessionsRefreshFansAcrossSessionsFamilyOnly() =
        runTest {
            val repo = FakeChargingRepository()
            val store = ChargingStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaChargingSessions().collect {} }
            backgroundScope.launch { store.teslaChargingHistory().collect {} }
            runCurrent()

            val result = store.refreshTeslaChargingSessions(dateFrom = "2026-02-01", dateTo = "2026-03-01")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple<String?, String?, String?>(null, "2026-02-01", "2026-03-01")), repo.sessionsRefreshes)
            assertEquals(2, repo.collections[teslaChargingSessionsKey(null)])
            assertEquals(1, repo.collections[teslaChargingHistoryKey(null)])
        }

    @Test
    fun optimizeChargeDelegatesAndRefreshesNothing() =
        runTest {
            val repo = FakeChargingRepository()
            val store = ChargingStore(repo, backgroundScope)
            backgroundScope.launch { store.chargePlans(7).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[chargePlansKey(7)])

            val input =
                OptimizeChargeInput(
                    vehicleId = 7,
                    targetSoc = 80,
                    departBy = "2026-06-15T07:00:00Z",
                    ratePlanId = "pge-ev2a",
                )
            val result = store.optimizeCharge(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.optimized)
            // The web hook invalidates nothing → no observed feed re-fetches.
            assertEquals(1, repo.collections[chargePlansKey(7)])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeChargingRepository()
            val store = ChargingStore(repo, backgroundScope)

            val result = store.bulkDeleteCharging(listOf(1))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.bulkDeleted.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
            assertNull(repo.collections[chargingSessionsKey(7)])
        }
}
