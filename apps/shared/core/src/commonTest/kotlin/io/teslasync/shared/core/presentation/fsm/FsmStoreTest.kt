package io.teslasync.shared.core.presentation.fsm

import io.teslasync.shared.core.data.repo.FsmRepository
import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.fsmTransitionsKey
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
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [FsmStore] folds the S7 [FsmRepository] into shared, refreshable feeds, honours
 * the web `enabled: !!entityId` gate, keys each feed by the web `fsmKeys` tuple, and routes refresh
 * to the right feed — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FsmStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success, labelled by the feed + its exact parameters so the test can assert routing.
     */
    private class FakeFsmRepository : FsmRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        private fun feed(label: String): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }

        override fun stats(entityId: String): Flow<Resource<JsonElement>> = feed("stats:$entityId")

        override fun transitions(
            entityId: String,
            fsmType: FsmType,
            hours: Int,
            page: Int,
            perPage: Int,
            startInstant: String?,
            endInstantExclusive: String?,
        ): Flow<Resource<JsonElement>> =
            feed("transitions:${fsmTransitionsKey(entityId, fsmType, hours, page, perPage, startInstant, endInstantExclusive)}")
    }

    @Test
    fun statsEmitsCacheThenNetwork() =
        runTest {
            val store = FsmStore(FakeFsmRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.stats("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("stats:7#1", last.data.toString().trim('"'))
        }

    @Test
    fun transitionsEmitsCacheThenNetwork() =
        runTest {
            val store = FsmStore(FakeFsmRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.transitions("7", FsmType.VEHICLE, 24, 1, 50).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            assertTrue(seen.last() is Resource.Success)
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = FsmStore(FakeFsmRepository(), backgroundScope)
            assertSame(store.stats("7"), store.stats("7"))
            assertSame(
                store.transitions("7", FsmType.ALL, 1, 1, 50),
                store.transitions("7", FsmType.ALL, 1, 1, 50),
            )
            // Distinct parameters are distinct feeds.
            assertTrue(store.stats("7") !== store.stats("8"))
            assertTrue(
                store.transitions("7", FsmType.ALL, 1, 1, 50) !==
                    store.transitions("7", FsmType.VEHICLE, 1, 1, 50),
            )
            assertTrue(
                store.transitions("7", FsmType.ALL, 1, 1, 50) !==
                    store.transitions("7", FsmType.ALL, 1, 2, 50),
            )
        }

    @Test
    fun statsGateReturnsStableDisabledFeedForNullOrBlank() =
        runTest {
            val repo = FakeFsmRepository()
            val store = FsmStore(repo, backgroundScope)

            val disabledNull = store.stats(null)
            val disabledBlank = store.stats("   ")
            val disabledEmpty = store.stats("")

            assertSame(disabledNull, disabledBlank)
            assertSame(disabledBlank, disabledEmpty)
            backgroundScope.launch { disabledNull.collect {} }
            runCurrent()
            assertTrue(disabledNull.value is Resource.Loading)
            // The repository is never touched for a disabled query.
            assertNull(repo.collections["stats:"])
        }

    @Test
    fun transitionsGateReturnsStableDisabledFeedPerParamSet() =
        runTest {
            val repo = FakeFsmRepository()
            val store = FsmStore(repo, backgroundScope)

            val a = store.transitions(null, FsmType.ALL, 1, 1, 50)
            val b = store.transitions("", FsmType.ALL, 1, 1, 50)
            // Same param tuple → same stable disabled instance regardless of null vs blank id.
            assertSame(a, b)
            // A different param tuple gets its own disabled instance.
            assertTrue(a !== store.transitions(null, FsmType.VEHICLE, 1, 1, 50))

            backgroundScope.launch { a.collect {} }
            runCurrent()
            assertTrue(a.value is Resource.Loading)
            assertTrue(repo.collections.isEmpty(), "no repository feed is collected for a disabled query")
        }

    @Test
    fun refreshStatsReFetchesObservedFeed() =
        runTest {
            val repo = FakeFsmRepository()
            val store = FsmStore(repo, backgroundScope)
            backgroundScope.launch { store.stats("7").collect {} }
            runCurrent()
            assertEquals(1, repo.collections["stats:7"])

            store.refreshStats("7")
            runCurrent()
            assertEquals(2, repo.collections["stats:7"])
        }

    @Test
    fun refreshTransitionsReFetchesOnlyTheMatchingFeed() =
        runTest {
            val repo = FakeFsmRepository()
            val store = FsmStore(repo, backgroundScope)
            backgroundScope.launch { store.transitions("7", FsmType.VEHICLE, 24, 1, 50).collect {} }
            backgroundScope.launch { store.stats("7").collect {} }
            runCurrent()
            val key = "transitions:${fsmTransitionsKey("7", FsmType.VEHICLE, 24, 1, 50)}"
            assertEquals(1, repo.collections[key])
            assertEquals(1, repo.collections["stats:7"])

            store.refreshTransitions("7", FsmType.VEHICLE, 24, 1, 50)
            runCurrent()
            assertEquals(2, repo.collections[key])
            // The stats feed is untouched by a transitions refresh.
            assertEquals(1, repo.collections["stats:7"])
        }

    @Test
    fun refreshIsANoOpForDisabledOrUnobservedFeeds() =
        runTest {
            val repo = FakeFsmRepository()
            val store = FsmStore(repo, backgroundScope)

            // Disabled id: no-op, repository never touched.
            store.refreshStats(null)
            store.refreshTransitions("", FsmType.ALL, 1, 1, 50)
            // Enabled but never observed: no upstream to restart.
            store.refreshStats("7")
            runCurrent()

            assertTrue(repo.collections.isEmpty())
        }
}
