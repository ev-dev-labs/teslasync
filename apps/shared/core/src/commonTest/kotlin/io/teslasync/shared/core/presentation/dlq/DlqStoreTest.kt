package io.teslasync.shared.core.presentation.dlq

import io.teslasync.shared.core.data.repo.DlqRepository
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
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [DlqStore] folds the S7 [DlqRepository] into shared, refreshable feeds, honours
 * the web `useDLQEntry` `enabled` gate, and routes replay to the right repository call + a
 * whole-prefix refresh — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DlqStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success; replay records its argument and succeeds.
     */
    private class FakeDlqRepository : DlqRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val replayed: MutableList<Long> = mutableListOf()

        private fun feed(label: String): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }

        override fun list(): Flow<Resource<JsonElement>> = feed("list")

        override fun entry(id: Long): Flow<Resource<JsonElement>> = feed("entry:$id")

        override fun audit(
            dlqId: Long?,
            limit: Int,
        ): Flow<Resource<JsonElement>> = feed(if (dlqId != null && dlqId > 0) "entry-audit:$dlqId:$limit" else "audit:$limit")

        override suspend fun replayEntry(id: Long): Result<JsonElement> {
            replayed += id
            return Result.success(JsonPrimitive("replayed"))
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = DlqStore(FakeDlqRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.list().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("list#1", last.data.toString().trim('"'))
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = DlqStore(FakeDlqRepository(), backgroundScope)
            assertSame(store.list(), store.list())
            // Distinct parameters are distinct feeds.
            assertTrue(store.entry(1) !== store.entry(2))
            assertTrue(store.audit(dlqId = null, limit = 50) !== store.audit(dlqId = 7, limit = 50))
        }

    @Test
    fun entryGateReturnsStableDisabledFeedForNonPositiveOrDisabled() =
        runTest {
            val repo = FakeDlqRepository()
            val store = DlqStore(repo, backgroundScope)

            val disabledNull = store.entry(null)
            val disabledZero = store.entry(0)
            val disabledNeg = store.entry(-5)
            val disabledFlag = store.entry(7, enabled = false)

            // All collapse to the same stable, non-fetching Loading instance.
            assertSame(disabledNull, disabledZero)
            assertSame(disabledZero, disabledNeg)
            assertSame(disabledNeg, disabledFlag)
            backgroundScope.launch { disabledNull.collect {} }
            runCurrent()
            assertTrue(disabledNull.value is Resource.Loading)
            // The repository is never touched for a disabled entry query.
            assertNull(repo.collections["entry:7"])
            assertNull(repo.collections["entry:0"])
        }

    @Test
    fun enabledEntryFetchesViaGuardedNumericId() =
        runTest {
            val repo = FakeDlqRepository()
            val store = DlqStore(repo, backgroundScope)
            backgroundScope.launch { store.entry(7).collect {} }
            runCurrent()
            assertEquals(1, repo.collections["entry:7"])
        }

    @Test
    fun globalAndScopedAuditTargetTheirOwnKeys() =
        runTest {
            val repo = FakeDlqRepository()
            val store = DlqStore(repo, backgroundScope)
            backgroundScope.launch { store.audit().collect {} }
            backgroundScope.launch { store.audit(dlqId = 7, limit = 100).collect {} }
            runCurrent()

            assertEquals(1, repo.collections["audit:50"], "default limit is 50 (PAGINATION.DEFAULT_LIMIT)")
            assertEquals(1, repo.collections["entry-audit:7:100"])
        }

    @Test
    fun replayDelegatesAndRefreshesEveryObservedFeed() =
        runTest {
            val repo = FakeDlqRepository()
            val store = DlqStore(repo, backgroundScope)
            backgroundScope.launch { store.list().collect {} }
            backgroundScope.launch { store.entry(7).collect {} }
            backgroundScope.launch { store.audit().collect {} }
            runCurrent()
            assertEquals(1, repo.collections["list"])
            assertEquals(1, repo.collections["entry:7"])
            assertEquals(1, repo.collections["audit:50"])

            val result = store.replay(7)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(7L), repo.replayed)
            // invalidateQueries(['system','dlq']) analogue: every observed feed re-fetches.
            assertEquals(2, repo.collections["list"])
            assertEquals(2, repo.collections["entry:7"])
            assertEquals(2, repo.collections["audit:50"])
        }

    @Test
    fun replayIsANoOpRefreshForUnobservedFeeds() =
        runTest {
            val repo = FakeDlqRepository()
            val store = DlqStore(repo, backgroundScope)

            // No one is observing any feed; replay still succeeds and is recorded, and nothing
            // is collected (no stale upstream restarted needlessly).
            val result = store.replay(9)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(9L), repo.replayed)
            assertNull(repo.collections["list"])
        }
}
