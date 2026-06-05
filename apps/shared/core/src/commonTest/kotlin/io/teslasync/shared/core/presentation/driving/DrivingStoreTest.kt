package io.teslasync.shared.core.presentation.driving

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.accelerationDistributionKey
import io.teslasync.shared.core.data.repo.driveDetailKey
import io.teslasync.shared.core.data.repo.drivePositionsKey
import io.teslasync.shared.core.data.repo.driveScoreKey
import io.teslasync.shared.core.data.repo.driveTelemetryKey
import io.teslasync.shared.core.data.repo.driveWhyEndedKey
import io.teslasync.shared.core.data.repo.drivesKey
import io.teslasync.shared.core.data.repo.drivetrainHealthKey
import io.teslasync.shared.core.data.repo.drivingCoachKey
import io.teslasync.shared.core.data.repo.drivingDynamicsKey
import io.teslasync.shared.core.data.repo.drivingStatsKey
import io.teslasync.shared.core.data.repo.geocodeSearchKey
import io.teslasync.shared.core.data.repo.regenEfficiencyKey
import io.teslasync.shared.core.data.repo.routeEfficiencyKey
import io.teslasync.shared.core.data.repo.speedProfileKey
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
 * Verifies the S8 [DrivingStore] folds the S7 [DrivingRepository] into shared, refreshable feeds
 * and routes each mutation to the right repository call + the EXACT web `invalidateQueries`
 * family — using a fake repository, so no network or cache is involved. Each fake read counts its
 * collections under the same cache key the store observes (computed via the shared key builders),
 * so a refresh is directly observable per feed.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DrivingStoreTest {
    private class FakeDrivingRepository : DrivingRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val planned: MutableList<TripPlanRequest> = mutableListOf()
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

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> = counting(drivesKey(vehicleId)) { listOf(drive(it.toLong())) }

        override fun drive(id: String): Flow<Resource<JsonElement>> = counting(driveDetailKey(id)) { JsonObject(emptyMap()) }

        override fun driveScore(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(driveScoreKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(drivingStatsKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun drivingDynamics(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(drivingDynamicsKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun accelerationDistribution(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(accelerationDistributionKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(drivetrainHealthKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun speedProfile(
            vehicleId: String,
            start: String?,
            end: String?,
        ): Flow<Resource<JsonElement>> = counting(speedProfileKey(vehicleId, start, end)) { JsonObject(emptyMap()) }

        override fun regenEfficiency(
            vehicleId: String,
            start: String?,
            end: String?,
        ): Flow<Resource<JsonElement>> = counting(regenEfficiencyKey(vehicleId, start, end)) { JsonObject(emptyMap()) }

        override fun routeEfficiency(
            vehicleId: String,
            start: String?,
            end: String?,
        ): Flow<Resource<JsonElement>> = counting(routeEfficiencyKey(vehicleId, start, end)) { JsonObject(emptyMap()) }

        override fun drivePositions(driveId: String): Flow<Resource<JsonElement>> =
            counting(drivePositionsKey(driveId)) { JsonObject(emptyMap()) }

        override fun driveTelemetry(driveId: String): Flow<Resource<List<DriveTelemetryReading>>> =
            counting(driveTelemetryKey(driveId)) { emptyList() }

        override fun drivingCoach(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = counting(drivingCoachKey(vehicleId, days)) { JsonObject(emptyMap()) }

        override fun geocodeSearch(query: String): Flow<Resource<JsonElement>> =
            counting(geocodeSearchKey(query)) { JsonObject(emptyMap()) }

        override fun driveWhyEnded(
            driveId: String,
            window: String,
        ): Flow<Resource<JsonElement>> = counting(driveWhyEndedKey(driveId, window)) { JsonObject(emptyMap()) }

        override suspend fun planTrip(input: TripPlanRequest): Result<JsonElement> {
            planned += input
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun bulkDeleteDrives(ids: List<Long>): Result<JsonElement> {
            bulkDeleted += ids
            return Result.success(JsonObject(emptyMap()))
        }

        companion object {
            fun drive(id: Long): Drive =
                Drive(
                    createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                    distanceM = 1234.5,
                    durationS = 600,
                    id = id,
                    startTs = Instant.parse("2026-01-01T00:00:00Z"),
                    updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
                    vehicleId = 7,
                )
        }
    }

    private fun tripRequest(): TripPlanRequest =
        TripPlanRequest(
            vehicleId = 7,
            origin = TripLocation(lat = 37.0, lng = -122.0, name = "Home"),
            destination = TripLocation(lat = 34.0, lng = -118.0, name = "LA"),
            currentSoc = 90,
            chargeLimitSoc = 90,
            minArrivalSoc = 10,
        )

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = DrivingStore(FakeDrivingRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<Drive>>>()
            backgroundScope.launch { store.drives("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(1, last.data.size)
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = DrivingStore(FakeDrivingRepository(), backgroundScope)
            assertSame(store.drives("7"), store.drives("7"))
            assertTrue(store.drives("7") !== store.drives("8"))
            // Distinct shapes never collide even when they share the underlying json feed map.
            assertTrue(store.driveScore("7") !== store.drivingStats("7"))
            // The range params participate in the key, so a different window is a different feed.
            assertTrue(store.speedProfile("7") !== store.speedProfile("7", start = "2026-01-01"))
        }

    @Test
    fun bulkDeleteRefreshesDrivesAndDriveFamiliesIncludingWhyEndedButNotSiblings() =
        runTest {
            val repo = FakeDrivingRepository()
            val store = DrivingStore(repo, backgroundScope)
            backgroundScope.launch { store.drives("7").collect {} }
            backgroundScope.launch { store.drive("5").collect {} }
            backgroundScope.launch { store.driveWhyEnded("5").collect {} }
            backgroundScope.launch { store.driveScore("7").collect {} }
            backgroundScope.launch { store.drivePositions("5").collect {} }
            backgroundScope.launch { store.driveTelemetry("5").collect {} }
            runCurrent()

            assertEquals(1, repo.collections[drivesKey("7")])
            assertEquals(1, repo.collections[driveDetailKey("5")])
            assertEquals(1, repo.collections[driveWhyEndedKey("5", DrivingRepository.DEFAULT_WHY_ENDED_WINDOW)])
            assertEquals(1, repo.collections[driveScoreKey("7")])
            assertEquals(1, repo.collections[drivePositionsKey("5")])
            assertEquals(1, repo.collections[driveTelemetryKey("5")])

            val result = store.bulkDeleteDrives(listOf(1, 2))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(listOf(1L, 2L)), repo.bulkDeleted)
            // ['drives'] prefix → the per-vehicle list re-fetches …
            assertEquals(2, repo.collections[drivesKey("7")])
            // … ['drive'] prefix → the detail AND the why-ended diagnostic re-fetch …
            assertEquals(2, repo.collections[driveDetailKey("5")])
            assertEquals(2, repo.collections[driveWhyEndedKey("5", DrivingRepository.DEFAULT_WHY_ENDED_WINDOW)])
            // … but the drive-score / drive-positions / drive-telemetry siblings are NOT descendants
            // of either ['drives'] or ['drive'] → untouched.
            assertEquals(1, repo.collections[driveScoreKey("7")])
            assertEquals(1, repo.collections[drivePositionsKey("5")])
            assertEquals(1, repo.collections[driveTelemetryKey("5")])
        }

    @Test
    fun planTripDelegatesAndRefreshesNothing() =
        runTest {
            val repo = FakeDrivingRepository()
            val store = DrivingStore(repo, backgroundScope)
            backgroundScope.launch { store.drives("7").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[drivesKey("7")])

            val input = tripRequest()
            val result = store.planTrip(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.planned)
            // The web hook invalidates nothing → no observed feed re-fetches.
            assertEquals(1, repo.collections[drivesKey("7")])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeDrivingRepository()
            val store = DrivingStore(repo, backgroundScope)

            val result = store.bulkDeleteDrives(listOf(1))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.bulkDeleted.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
            assertNull(repo.collections[drivesKey("7")])
        }
}
