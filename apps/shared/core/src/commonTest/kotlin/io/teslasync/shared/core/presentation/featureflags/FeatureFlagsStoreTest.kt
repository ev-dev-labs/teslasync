package io.teslasync.shared.core.presentation.featureflags

import io.teslasync.shared.core.data.repo.FeatureFlagsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.flagCacheKey
import io.teslasync.shared.core.data.repo.flagChangesCacheKey
import io.teslasync.shared.core.data.repo.flagsListCacheKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [FeatureFlagsStore] folds the S7 [FeatureFlagsRepository] into shared,
 * refreshable feeds and routes each mutation to the right repository call + an invalidate-all
 * refresh — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FeatureFlagsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per feed key (so a refresh is observable)
     * and emits Loading→Success; every mutation records its arguments and succeeds.
     */
    private class FakeFeatureFlagsRepository : FeatureFlagsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val sets: MutableList<Triple<String, String, String>> = mutableListOf()
        val deletes: MutableList<Pair<String, String>> = mutableListOf()

        private fun <T> feed(
            key: String,
            value: (Int) -> T,
        ): Flow<Resource<T>> =
            flow {
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value(n), fetchedAt = 1L, stale = false))
            }

        override fun flags(): Flow<Resource<FeatureFlagsListResponse>> =
            feed(flagsListCacheKey()) { n -> FeatureFlagsListResponse(count = n, flags = emptyList()) }

        override fun flag(key: String): Flow<Resource<FeatureFlagEntry>> =
            feed(flagCacheKey(key)) { n -> FeatureFlagEntry(key = key, value = JsonPrimitive(n)) }

        override fun flagChanges(
            flagKey: String?,
            limit: Int,
        ): Flow<Resource<FeatureFlagChangesResponse>> =
            feed(flagChangesCacheKey(flagKey, limit)) { n ->
                FeatureFlagChangesResponse(count = n, flagKey = flagKey ?: "", limit = limit, rows = emptyList())
            }

        override suspend fun setFlag(
            key: String,
            value: kotlinx.serialization.json.JsonElement,
            reason: String,
        ): Result<FeatureFlagWriteResponse> {
            sets += Triple(key, value.toString(), reason)
            return Result.success(FeatureFlagWriteResponse(key = key, auditId = 1))
        }

        override suspend fun deleteFlag(
            key: String,
            reason: String,
        ): Result<FeatureFlagWriteResponse> {
            deletes += key to reason
            return Result.success(FeatureFlagWriteResponse(key = key, deleted = true, auditId = 2))
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = FeatureFlagsStore(FakeFeatureFlagsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<FeatureFlagsListResponse>>()
            backgroundScope.launch { store.flags().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(1, last.data.count)
        }

    @Test
    fun sameFeedIsSharedAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = FeatureFlagsStore(FakeFeatureFlagsRepository(), backgroundScope)
            assertSame(store.flags(), store.flags())
            assertSame(store.flag("alpha"), store.flag("alpha"))
            // A scoped change feed and the global feed are distinct, as are two distinct flags.
            assertTrue(store.flagChanges() !== store.flagChanges("alpha"))
            assertTrue(store.flag("alpha") !== store.flag("beta"))
        }

    @Test
    fun flagRequiresNonBlankKey() =
        runTest {
            val store = FeatureFlagsStore(FakeFeatureFlagsRepository(), backgroundScope)
            assertFailsWith<IllegalArgumentException> { store.flag("") }
        }

    @Test
    fun scopedAndGlobalChangeFeedsTargetTheirOwnKeys() =
        runTest {
            val repo = FakeFeatureFlagsRepository()
            val store = FeatureFlagsStore(repo, backgroundScope)
            backgroundScope.launch { store.flagChanges().collect {} }
            backgroundScope.launch { store.flagChanges("alpha", limit = 10).collect {} }
            runCurrent()

            assertEquals(1, repo.collections[flagChangesCacheKey(null, 50)])
            assertEquals(1, repo.collections[flagChangesCacheKey("alpha", 10)])
        }

    @Test
    fun setFlagDelegatesAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakeFeatureFlagsRepository()
            val store = FeatureFlagsStore(repo, backgroundScope)
            backgroundScope.launch { store.flags().collect {} }
            backgroundScope.launch { store.flag("alpha").collect {} }
            backgroundScope.launch { store.flagChanges("alpha").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[flagsListCacheKey()])
            assertEquals(1, repo.collections[flagCacheKey("alpha")])
            assertEquals(1, repo.collections[flagChangesCacheKey("alpha", 50)])

            val result = store.setFlag("alpha", JsonPrimitive(true), "enable beta")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple("alpha", "true", "enable beta")), repo.sets)
            // invalidate the whole prefix: ALL observed feeds re-fetch.
            assertEquals(2, repo.collections[flagsListCacheKey()])
            assertEquals(2, repo.collections[flagCacheKey("alpha")])
            assertEquals(2, repo.collections[flagChangesCacheKey("alpha", 50)])
        }

    @Test
    fun deleteFlagDelegatesAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakeFeatureFlagsRepository()
            val store = FeatureFlagsStore(repo, backgroundScope)
            backgroundScope.launch { store.flags().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[flagsListCacheKey()])

            val result = store.deleteFlag("alpha", "retired")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("alpha" to "retired"), repo.deletes)
            assertEquals(2, repo.collections[flagsListCacheKey()])
        }

    @Test
    fun refreshAllIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeFeatureFlagsRepository()
            val store = FeatureFlagsStore(repo, backgroundScope)

            val result = store.setFlag("alpha", JsonPrimitive(1), "init")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.sets.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
