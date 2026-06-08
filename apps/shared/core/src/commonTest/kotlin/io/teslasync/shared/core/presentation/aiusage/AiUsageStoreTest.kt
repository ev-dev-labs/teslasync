package io.teslasync.shared.core.presentation.aiusage

import io.teslasync.shared.core.data.repo.AiUsageRepository
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
 * Verifies the S8 [AiUsageStore] folds the S7 [AiUsageRepository] into shared, refreshable
 * feeds — using a fake repository, so no network or cache is involved. Mirrors the web
 * `useAiUsage` hooks: three reads, no mutations, snake_case params keyed independently.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AiUsageStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections (so a refresh is observable) and
     * emits Loading→Success.
     */
    private class FakeAiUsageRepository : AiUsageRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        private fun feed(label: String): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }

        override fun today(): Flow<Resource<JsonElement>> = feed("today")

        override fun byFeature(since: String?): Flow<Resource<JsonElement>> = feed("by-feature:${since ?: ""}")

        override fun recent(limit: Int?): Flow<Resource<JsonElement>> = feed("recent:${limit ?: 0}")
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AiUsageStore(FakeAiUsageRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.today().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("today#1", last.data.toString().trim('"'))
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = AiUsageStore(FakeAiUsageRepository(), backgroundScope)
            assertSame(store.today(), store.today())
            assertSame(store.byFeature("2026-01-01T00:00:00Z"), store.byFeature("2026-01-01T00:00:00Z"))
            assertSame(store.recent(50), store.recent(50))
        }

    @Test
    fun parameterizedReadsTargetTheirOwnKeys() =
        runTest {
            val repo = FakeAiUsageRepository()
            val store = AiUsageStore(repo, backgroundScope)
            backgroundScope.launch { store.byFeature("2026-01-01T00:00:00Z").collect {} }
            backgroundScope.launch { store.byFeature(null).collect {} }
            backgroundScope.launch { store.recent(100).collect {} }
            backgroundScope.launch { store.recent(null).collect {} }
            runCurrent()

            assertEquals(1, repo.collections["by-feature:2026-01-01T00:00:00Z"])
            assertEquals(1, repo.collections["by-feature:"])
            assertEquals(1, repo.collections["recent:100"])
            assertEquals(1, repo.collections["recent:0"])
            // Distinct params are distinct feeds.
            assertTrue(store.recent(100) !== store.recent(50))
            assertTrue(store.byFeature(null) !== store.byFeature("x"))
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeAiUsageRepository()
            val store = AiUsageStore(repo, backgroundScope)
            backgroundScope.launch { store.today().collect {} }
            backgroundScope.launch { store.byFeature(null).collect {} }
            backgroundScope.launch { store.recent(25).collect {} }
            runCurrent()
            assertEquals(1, repo.collections["today"])
            assertEquals(1, repo.collections["by-feature:"])
            assertEquals(1, repo.collections["recent:25"])

            store.refreshToday()
            store.refreshByFeature(null)
            store.refreshRecent(25)
            runCurrent()

            assertEquals(2, repo.collections["today"], "refresh re-collects the today feed")
            assertEquals(2, repo.collections["by-feature:"], "refresh re-collects the by-feature feed")
            assertEquals(2, repo.collections["recent:25"], "refresh re-collects the recent feed")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeAiUsageRepository()
            val store = AiUsageStore(repo, backgroundScope)

            // No one is observing today; a refresh must not start a stale upstream needlessly.
            store.refreshToday()
            runCurrent()

            assertEquals(null, repo.collections["today"])
        }
}
