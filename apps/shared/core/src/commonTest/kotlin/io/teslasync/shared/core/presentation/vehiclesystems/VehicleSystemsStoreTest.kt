package io.teslasync.shared.core.presentation.vehiclesystems

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSystemsRepository
import io.teslasync.shared.core.data.repo.climateHistoryKey
import io.teslasync.shared.core.data.repo.climateKey
import io.teslasync.shared.core.data.repo.maintenanceKey
import io.teslasync.shared.core.data.repo.mediaHistoryKey
import io.teslasync.shared.core.data.repo.mediaKey
import io.teslasync.shared.core.data.repo.safetyHistoryKey
import io.teslasync.shared.core.data.repo.safetyKey
import io.teslasync.shared.core.data.repo.serviceRecordsKey
import io.teslasync.shared.core.data.repo.softwareUpdatesKey
import io.teslasync.shared.core.data.repo.tirePressureHistoryKey
import io.teslasync.shared.core.data.repo.tirePressureKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [VehicleSystemsStore] folds the S7 [VehicleSystemsRepository] into shared,
 * refreshable feeds — using a fake repository, so no network or cache is involved. Each fake read
 * counts its collections under the same cache key the store observes (computed via the shared key
 * builders), so cache→network emission, feed sharing, and refresh fan-out are directly observable.
 * The fake records the exact `vehicleId` each call received so the `software-updates`-vs-`vehicle_id`
 * behaviour can be asserted.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleSystemsStoreTest {
    private class FakeVehicleSystemsRepository : VehicleSystemsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val softwareUpdateVehicleIds: MutableList<String> = mutableListOf()

        private fun counting(
            key: String,
            value: (Int) -> JsonElement,
        ): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value(n), fetchedAt = 1L, stale = false))
            }

        override fun climate(vehicleId: String): Flow<Resource<JsonElement>> = counting(climateKey(vehicleId)) { JsonPrimitive(it) }

        override fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(climateHistoryKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun tirePressure(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(tirePressureKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun tirePressureHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(tirePressureHistoryKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun maintenance(): Flow<Resource<JsonElement>> = counting(maintenanceKey()) { JsonObject(emptyMap()) }

        override fun serviceRecords(): Flow<Resource<JsonElement>> = counting(serviceRecordsKey()) { JsonObject(emptyMap()) }

        override fun softwareUpdates(vehicleId: String): Flow<Resource<JsonElement>> {
            softwareUpdateVehicleIds += vehicleId
            return counting(softwareUpdatesKey(vehicleId)) { JsonObject(emptyMap()) }
        }

        override fun safety(vehicleId: String): Flow<Resource<JsonElement>> = counting(safetyKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun safetyHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(safetyHistoryKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun media(vehicleId: String): Flow<Resource<JsonElement>> = counting(mediaKey(vehicleId)) { JsonObject(emptyMap()) }

        override fun mediaHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(mediaHistoryKey(vehicleId)) { JsonObject(emptyMap()) }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = VehicleSystemsStore(FakeVehicleSystemsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.climate("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(JsonPrimitive(1), last.data)
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = VehicleSystemsStore(FakeVehicleSystemsRepository(), backgroundScope)
            assertSame(store.climate("7"), store.climate("7"))
            assertTrue(store.climate("7") !== store.climate("8"))
            // The 'latest' and 'history' feeds are distinct shapes that must never collide.
            assertTrue(store.climate("7") !== store.climateHistory("7"))
            assertTrue(store.safety("7") !== store.safetyHistory("7"))
            assertTrue(store.media("7") !== store.mediaHistory("7"))
            // The global catalogs are shared singletons.
            assertSame(store.maintenance(), store.maintenance())
            assertSame(store.serviceRecords(), store.serviceRecords())
        }

    @Test
    fun allElevenReadsEmitCacheThenNetwork() =
        runTest {
            val repo = FakeVehicleSystemsRepository()
            val store = VehicleSystemsStore(repo, backgroundScope)
            backgroundScope.launch { store.climate("7").collect {} }
            backgroundScope.launch { store.climateHistory("7").collect {} }
            backgroundScope.launch { store.tirePressure("7").collect {} }
            backgroundScope.launch { store.tirePressureHistory("7").collect {} }
            backgroundScope.launch { store.maintenance().collect {} }
            backgroundScope.launch { store.serviceRecords().collect {} }
            backgroundScope.launch { store.softwareUpdates("7").collect {} }
            backgroundScope.launch { store.safety("7").collect {} }
            backgroundScope.launch { store.safetyHistory("7").collect {} }
            backgroundScope.launch { store.media("7").collect {} }
            backgroundScope.launch { store.mediaHistory("7").collect {} }
            runCurrent()

            // Every one of the eleven ported feeds collected exactly once from the repo.
            assertEquals(1, repo.collections[climateKey("7")])
            assertEquals(1, repo.collections[climateHistoryKey("7")])
            assertEquals(1, repo.collections[tirePressureKey("7")])
            assertEquals(1, repo.collections[tirePressureHistoryKey("7")])
            assertEquals(1, repo.collections[maintenanceKey()])
            assertEquals(1, repo.collections[serviceRecordsKey()])
            assertEquals(1, repo.collections[softwareUpdatesKey("7")])
            assertEquals(1, repo.collections[safetyKey("7")])
            assertEquals(1, repo.collections[safetyHistoryKey("7")])
            assertEquals(1, repo.collections[mediaKey("7")])
            assertEquals(1, repo.collections[mediaHistoryKey("7")])
            assertEquals(11, repo.collections.size, "exactly the eleven ported feeds, no more")
        }

    @Test
    fun softwareUpdatesIsKeyedPerVehicleAndForwardsTheVehicleId() =
        runTest {
            val repo = FakeVehicleSystemsRepository()
            val store = VehicleSystemsStore(repo, backgroundScope)
            backgroundScope.launch { store.softwareUpdates("7").collect {} }
            backgroundScope.launch { store.softwareUpdates("8").collect {} }
            runCurrent()

            // Distinct vehicles ⇒ distinct cache slots even though the request carries no vehicle_id.
            assertEquals(1, repo.collections[softwareUpdatesKey("7")])
            assertEquals(1, repo.collections[softwareUpdatesKey("8")])
            assertTrue(store.softwareUpdates("7") !== store.softwareUpdates("8"))
            assertEquals(listOf("7", "8"), repo.softwareUpdateVehicleIds)
        }

    @Test
    fun refreshReFetchesEveryObservedFeed() =
        runTest {
            val repo = FakeVehicleSystemsRepository()
            val store = VehicleSystemsStore(repo, backgroundScope)
            backgroundScope.launch { store.climate("7").collect {} }
            backgroundScope.launch { store.maintenance().collect {} }
            runCurrent()

            assertEquals(1, repo.collections[climateKey("7")])
            assertEquals(1, repo.collections[maintenanceKey()])

            store.refresh()
            runCurrent()

            // Both observed feeds re-collected via cache-then-network.
            assertEquals(2, repo.collections[climateKey("7")])
            assertEquals(2, repo.collections[maintenanceKey()])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeVehicleSystemsRepository()
            val store = VehicleSystemsStore(repo, backgroundScope)

            store.refresh()
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
            assertNull(repo.collections[climateKey("7")])
        }
}
