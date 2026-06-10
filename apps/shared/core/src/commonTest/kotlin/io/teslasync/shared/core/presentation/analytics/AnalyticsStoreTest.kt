package io.teslasync.shared.core.presentation.analytics

import io.teslasync.shared.core.data.repo.AnalyticsRepository
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
 * Verifies the S8 [AnalyticsStore] folds the S7 [AnalyticsRepository] into shared, refreshable
 * feeds and routes each read + refresh to the right repository call + key — using a fake
 * repository, so no network or cache is involved. The domain is read-only, so the matrix here
 * is reads (cache→network, sharing, parameterised keys) and the generic refresh.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnalyticsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections (so a refresh is observable) and
     * emits Loading→Success.
     */
    private class FakeAnalyticsRepository : AnalyticsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        private fun feed(label: String): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }

        override fun analyticsSummary(days: Int): Flow<Resource<JsonElement>> = feed("summary:$days")

        override fun fleetAnalytics(
            days: Int?,
            start: String?,
            end: String?,
        ): Flow<Resource<JsonElement>> = feed("fleet:$days:$start:$end")

        override fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>> = feed("mileage:$vehicleId")

        override fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>> = feed("monthly:$vehicleId")

        override fun dailyMileage(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = feed("daily:$vehicleId:$days")

        override fun costBreakdown(vehicleId: String): Flow<Resource<JsonElement>> = feed("cost:$vehicleId")

        override fun timeline(vehicleId: String): Flow<Resource<JsonElement>> = feed("timeline:$vehicleId")

        override fun stateSummary(vehicleId: String): Flow<Resource<JsonElement>> = feed("state-summary:$vehicleId")

        override fun weeklyDigest(vehicleId: String): Flow<Resource<JsonElement>> = feed("weekly-digest:$vehicleId")

        override fun lifetimeStats(vehicleId: String?): Flow<Resource<JsonElement>> = feed("lifetime:$vehicleId")

        override fun yearReview(
            year: Int,
            vehicleId: String?,
        ): Flow<Resource<JsonElement>> = feed("year-review:$year:$vehicleId")
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AnalyticsStore(FakeAnalyticsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.analyticsSummary(30).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("summary:30#1", last.data.toString().trim('"'))
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = AnalyticsStore(FakeAnalyticsRepository(), backgroundScope)
            assertSame(store.analyticsSummary(30), store.analyticsSummary(30))
            // Distinct parameters are distinct feeds.
            assertTrue(store.analyticsSummary(30) !== store.analyticsSummary(7))
            assertTrue(store.dailyMileage("7", 90) !== store.dailyMileage("7", 30))
        }

    @Test
    fun fleetBoundsFormDistinctFeeds() =
        runTest {
            val store = AnalyticsStore(FakeAnalyticsRepository(), backgroundScope)
            assertSame(store.fleetAnalytics(), store.fleetAnalytics())
            assertTrue(store.fleetAnalytics(days = 30) !== store.fleetAnalytics(start = "a", end = "b"))
        }

    @Test
    fun parameterizedReadsTargetTheirOwnKeys() =
        runTest {
            val repo = FakeAnalyticsRepository()
            val store = AnalyticsStore(repo, backgroundScope)
            backgroundScope.launch { store.mileageStats("9").collect {} }
            backgroundScope.launch { store.monthlyMileage("9").collect {} }
            backgroundScope.launch { store.dailyMileage("9", days = 45).collect {} }
            backgroundScope.launch { store.costBreakdown("9").collect {} }
            backgroundScope.launch { store.timeline("9").collect {} }
            backgroundScope.launch { store.stateSummary("9").collect {} }
            backgroundScope.launch { store.weeklyDigest("9").collect {} }
            backgroundScope.launch { store.lifetimeStats("9").collect {} }
            backgroundScope.launch { store.yearReview(2026, "9").collect {} }
            runCurrent()

            assertEquals(1, repo.collections["mileage:9"])
            assertEquals(1, repo.collections["monthly:9"])
            assertEquals(1, repo.collections["daily:9:45"])
            assertEquals(1, repo.collections["cost:9"])
            assertEquals(1, repo.collections["timeline:9"])
            assertEquals(1, repo.collections["state-summary:9"])
            assertEquals(1, repo.collections["weekly-digest:9"])
            assertEquals(1, repo.collections["lifetime:9"])
            assertEquals(1, repo.collections["year-review:2026:9"])
        }

    @Test
    fun refreshReCollectsAnObservedFeed() =
        runTest {
            val repo = FakeAnalyticsRepository()
            val store = AnalyticsStore(repo, backgroundScope)
            backgroundScope.launch { store.fleetAnalytics(days = 30).collect {} }
            runCurrent()
            assertEquals(1, repo.collections["fleet:30:null:null"])

            store.refreshFleetAnalytics(days = 30)
            runCurrent()

            assertEquals(2, repo.collections["fleet:30:null:null"], "refresh re-collects the upstream")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeAnalyticsRepository()
            val store = AnalyticsStore(repo, backgroundScope)

            // No one is observing lifetime; the refresh is a no-op and nothing is collected.
            store.refreshLifetimeStats("9")
            runCurrent()

            assertEquals(null, repo.collections["lifetime:9"])
        }

    @Test
    fun lifetimeNullAndPresentVehicleAreDistinctFeeds() =
        runTest {
            val repo = FakeAnalyticsRepository()
            val store = AnalyticsStore(repo, backgroundScope)
            backgroundScope.launch { store.lifetimeStats(null).collect {} }
            backgroundScope.launch { store.lifetimeStats("9").collect {} }
            runCurrent()

            assertEquals(1, repo.collections["lifetime:null"])
            assertEquals(1, repo.collections["lifetime:9"])
        }
}
