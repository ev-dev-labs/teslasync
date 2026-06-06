package io.teslasync.shared.core.presentation.vehicles

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.data.repo.chargingTelemetryLatestKey
import io.teslasync.shared.core.data.repo.climateLatestKey
import io.teslasync.shared.core.data.repo.driveDynamicsLatestKey
import io.teslasync.shared.core.data.repo.locationSnapshotLatestKey
import io.teslasync.shared.core.data.repo.mediaLatestKey
import io.teslasync.shared.core.data.repo.mobileEnabledKey
import io.teslasync.shared.core.data.repo.motorHistoryKey
import io.teslasync.shared.core.data.repo.motorLatestKey
import io.teslasync.shared.core.data.repo.securityLatestKey
import io.teslasync.shared.core.data.repo.tirePressureLatestKey
import io.teslasync.shared.core.data.repo.userPreferenceLatestKey
import io.teslasync.shared.core.data.repo.vehicleConfigLatestKey
import io.teslasync.shared.core.data.repo.vehicleDetailKey
import io.teslasync.shared.core.data.repo.vehicleOptionsKey
import io.teslasync.shared.core.data.repo.vehiclePositionsKey
import io.teslasync.shared.core.data.repo.vehicleSpecsKey
import io.teslasync.shared.core.data.repo.vehicleStateKey
import io.teslasync.shared.core.data.repo.vehicleSubscriptionsKey
import io.teslasync.shared.core.data.repo.vehicleUpgradesKey
import io.teslasync.shared.core.data.repo.vehiclesKey
import io.teslasync.shared.core.data.repo.warrantyDetailsKey
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
 * Verifies the S8 [VehiclesStore] folds the S7 [VehiclesRepository] into shared, refreshable feeds
 * and routes each mutation to the right repository call + the EXACT web `invalidateQueries` family —
 * using a fake repository, so no network or cache is involved. Each fake read counts its collections
 * under the same cache key the store observes (computed via the shared key builders), so a refresh is
 * directly observable per feed.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclesStoreTest {
    private class FakeVehiclesRepository : VehiclesRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val refreshed: MutableList<String> = mutableListOf()
        val deleted: MutableList<Long> = mutableListOf()
        val waked: MutableList<Long> = mutableListOf()
        var synced: Int = 0

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

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = counting(vehiclesKey()) { listOf(vehicle(it.toLong())) }

        override fun vehicle(id: String): Flow<Resource<Vehicle>> = counting(vehicleDetailKey(id)) { vehicle(id.toLong()) }

        override fun vehicleState(
            vehicleId: Long,
            asOf: String?,
        ): Flow<Resource<VehicleStateEnvelope>> =
            counting(vehicleStateKey(vehicleId, asOf)) { VehicleStateEnvelope(state = null, live = false) }

        override fun vehiclePositions(
            vehicleId: Long,
            limit: Int,
        ): Flow<Resource<JsonElement>> = counting(vehiclePositionsKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(motorLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun motorHistory(
            vehicleId: Long,
            limit: Int,
        ): Flow<Resource<JsonElement>> = counting(motorHistoryKey(vehicleId, limit)) { JsonObject(emptyMap()) }

        override fun driveDynamicsLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(driveDynamicsLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(climateLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(securityLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun latestTirePressure(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(tirePressureLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(chargingTelemetryLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun mediaLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(mediaLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun locationSnapshotLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(locationSnapshotLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun vehicleConfigLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(vehicleConfigLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun userPreferenceLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            counting(userPreferenceLatestKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun vehicleMobileEnabled(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(mobileEnabledKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun vehicleOptions(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(vehicleOptionsKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun vehicleSpecs(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(vehicleSpecsKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun vehicleSubscriptions(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(vehicleSubscriptionsKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(vehicleUpgradesKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun warrantyDetails(): Flow<Resource<JsonElement>> = counting(warrantyDetailsKey()) { JsonObject(emptyMap()) }

        override suspend fun refreshVehicle(id: String): Result<Vehicle> {
            refreshed += id
            return Result.success(vehicle(id.toLong()))
        }

        override suspend fun deleteVehicle(id: Long): Result<Unit> {
            deleted += id
            return Result.success(Unit)
        }

        override suspend fun syncVehicles(): Result<JsonElement> {
            synced += 1
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun wakeVehicle(id: Long): Result<JsonElement> {
            waked += id
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun refreshVehicleMobileEnabled(id: String): Result<JsonElement> = Result.success(JsonObject(emptyMap()))

        override suspend fun refreshVehicleOptions(id: String): Result<JsonElement> = Result.success(JsonObject(emptyMap()))

        override suspend fun refreshVehicleSpecs(id: String): Result<JsonElement> = Result.success(JsonObject(emptyMap()))

        override suspend fun refreshVehicleSubscriptions(id: String): Result<JsonElement> = Result.success(JsonObject(emptyMap()))

        override suspend fun refreshVehicleUpgrades(id: String): Result<JsonElement> = Result.success(JsonObject(emptyMap()))

        override suspend fun refreshWarrantyDetails(): Result<JsonElement> = Result.success(JsonObject(emptyMap()))

        companion object {
            fun vehicle(id: Long): Vehicle =
                Vehicle(
                    createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                    displayName = "Car $id",
                    enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
                    id = id,
                    teslaId = 1000 + id,
                    timezone = "UTC",
                    updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
                    vin = "VIN$id",
                )
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = VehiclesStore(FakeVehiclesRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<Vehicle>>>()
            backgroundScope.launch { store.vehicles().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(1, last.data.size)
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = VehiclesStore(FakeVehiclesRepository(), backgroundScope)
            assertSame(store.vehicles(), store.vehicles())
            assertSame(store.vehicleState(7), store.vehicleState(7))
            assertTrue(store.vehicle("7") !== store.vehicle("8"))
            // Distinct shapes never collide even when they share the underlying json feed map.
            assertTrue(store.motorLatest(7) !== store.climateLatest(7))
            // The as_of slot participates in the key, so a historical read is a different feed.
            assertTrue(store.vehicleState(7) !== store.vehicleState(7, asOf = "2026-01-01T00:00:00Z"))
        }

    @Test
    fun refreshVehicleRefreshesVehiclesFamilyListAndDetailButNotCousins() =
        runTest {
            val repo = FakeVehiclesRepository()
            val store = VehiclesStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicles().collect {} }
            backgroundScope.launch { store.vehicle("7").collect {} }
            backgroundScope.launch { store.vehicleState(7).collect {} }
            backgroundScope.launch { store.vehicleOptions("7").collect {} }
            runCurrent()

            assertEquals(1, repo.collections[vehiclesKey()])
            assertEquals(1, repo.collections[vehicleDetailKey("7")])
            assertEquals(1, repo.collections[vehicleStateKey(7)])
            assertEquals(1, repo.collections[vehicleOptionsKey("7")])

            val result = store.refreshVehicle("7")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("7"), repo.refreshed)
            // ['vehicles'] prefix → the list AND the per-vehicle detail re-fetch …
            assertEquals(2, repo.collections[vehiclesKey()])
            assertEquals(2, repo.collections[vehicleDetailKey("7")])
            // … but the vehicle-state and vehicle-options cousins are NOT descendants of ['vehicles'].
            assertEquals(1, repo.collections[vehicleStateKey(7)])
            assertEquals(1, repo.collections[vehicleOptionsKey("7")])
        }

    @Test
    fun deleteAndSyncRefreshVehiclesFamily() =
        runTest {
            val repo = FakeVehiclesRepository()
            val store = VehiclesStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicles().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[vehiclesKey()])

            assertTrue(store.deleteVehicle(7).isSuccess)
            runCurrent()
            assertEquals(listOf(7L), repo.deleted)
            assertEquals(2, repo.collections[vehiclesKey()])

            assertTrue(store.syncVehicles().isSuccess)
            runCurrent()
            assertEquals(1, repo.synced)
            assertEquals(3, repo.collections[vehiclesKey()])
        }

    @Test
    fun wakeRefreshesNothing() =
        runTest {
            val repo = FakeVehiclesRepository()
            val store = VehiclesStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicles().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[vehiclesKey()])

            val result = store.wakeVehicle(7)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(7L), repo.waked)
            // The web hook invalidates nothing → no observed feed re-fetches.
            assertEquals(1, repo.collections[vehiclesKey()])
        }

    @Test
    fun infoRefreshRefreshesOnlyItsOwnFeed() =
        runTest {
            val repo = FakeVehiclesRepository()
            val store = VehiclesStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicleOptions("7").collect {} }
            backgroundScope.launch { store.vehicleSpecs("7").collect {} }
            backgroundScope.launch { store.warrantyDetails().collect {} }
            backgroundScope.launch { store.vehicles().collect {} }
            runCurrent()

            assertTrue(store.refreshVehicleOptions("7").isSuccess)
            runCurrent()

            // Only ['vehicle-options', 7] re-fetches — the specs/warranty/list feeds are untouched.
            assertEquals(2, repo.collections[vehicleOptionsKey("7")])
            assertEquals(1, repo.collections[vehicleSpecsKey("7")])
            assertEquals(1, repo.collections[warrantyDetailsKey()])
            assertEquals(1, repo.collections[vehiclesKey()])

            assertTrue(store.refreshWarrantyDetails().isSuccess)
            runCurrent()
            assertEquals(2, repo.collections[warrantyDetailsKey()])
            assertEquals(1, repo.collections[vehicleSpecsKey("7")])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeVehiclesRepository()
            val store = VehiclesStore(repo, backgroundScope)

            val result = store.syncVehicles()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.synced)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
            assertNull(repo.collections[vehiclesKey()])
        }
}
