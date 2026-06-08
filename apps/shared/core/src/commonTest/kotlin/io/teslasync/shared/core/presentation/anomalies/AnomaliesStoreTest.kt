package io.teslasync.shared.core.presentation.anomalies

import io.teslasync.shared.core.data.repo.AnomaliesRepository
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
 * Verifies the S8 [AnomaliesStore] folds the S7 [AnomaliesRepository] into a shared, refreshable
 * feed — using a fake repository, so no network or cache is involved. Mirrors the web `useAnomalies`
 * hook: one read keyed by snake_case `(vehicle_id, days)`, no mutations, and the
 * `enabled: vehicleId !== null` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnomaliesStoreTest {
    /**
     * Fake S7 port: the read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success.
     */
    private class FakeAnomaliesRepository : AnomaliesRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        override fun anomalies(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> =
            flow {
                val label = "$vehicleId:$days"
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AnomaliesStore(FakeAnomaliesRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.anomalies("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("7:7#1", last.data.toString().trim('"'))
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = AnomaliesStore(FakeAnomaliesRepository(), backgroundScope)
            assertSame(store.anomalies("7"), store.anomalies("7"))
            assertSame(store.anomalies("7", days = 30), store.anomalies("7", days = 30))
        }

    @Test
    fun parameterizedReadsTargetTheirOwnKeys() =
        runTest {
            val repo = FakeAnomaliesRepository()
            val store = AnomaliesStore(repo, backgroundScope)
            backgroundScope.launch { store.anomalies("7").collect {} }
            backgroundScope.launch { store.anomalies("7", days = 30).collect {} }
            backgroundScope.launch { store.anomalies("9").collect {} }
            runCurrent()

            assertEquals(1, repo.collections["7:7"])
            assertEquals(1, repo.collections["7:30"])
            assertEquals(1, repo.collections["9:7"])
            // Distinct vehicle / window ⇒ distinct feeds.
            assertTrue(store.anomalies("7") !== store.anomalies("9"))
            assertTrue(store.anomalies("7") !== store.anomalies("7", days = 30))
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeAnomaliesRepository()
            val store = AnomaliesStore(repo, backgroundScope)
            backgroundScope.launch { store.anomalies("7").collect {} }
            runCurrent()
            assertEquals(1, repo.collections["7:7"])

            store.refreshAnomalies("7")
            runCurrent()

            assertEquals(2, repo.collections["7:7"], "refresh re-collects the anomalies feed")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeAnomaliesRepository()
            val store = AnomaliesStore(repo, backgroundScope)

            store.refreshAnomalies("7")
            runCurrent()

            assertEquals(null, repo.collections["7:7"])
        }

    @Test
    fun disabledFeedNeverFetchesAndStaysLoading() =
        runTest {
            val repo = FakeAnomaliesRepository()
            val store = AnomaliesStore(repo, backgroundScope)

            val seen = mutableListOf<Resource<JsonElement>>()
            val feed = store.anomalies(vehicleId = null)
            backgroundScope.launch { feed.collect { seen += it } }
            runCurrent()

            // vehicleId == null ⇒ no repository call, and the feed stays at the initial Loading slot
            // (web `enabled: vehicleId !== null`).
            assertTrue(repo.collections.isEmpty())
            assertTrue(seen.all { it is Resource.Loading })
            // The disabled feed is stable across calls for the same window (so the UI binds once).
            assertSame(feed, store.anomalies(vehicleId = null))
        }

    @Test
    fun refreshIsNoOpForADisabledFeed() =
        runTest {
            val repo = FakeAnomaliesRepository()
            val store = AnomaliesStore(repo, backgroundScope)
            backgroundScope.launch { store.anomalies(vehicleId = null).collect {} }
            runCurrent()

            store.refreshAnomalies(vehicleId = null)
            runCurrent()

            assertTrue(repo.collections.isEmpty())
        }
}
