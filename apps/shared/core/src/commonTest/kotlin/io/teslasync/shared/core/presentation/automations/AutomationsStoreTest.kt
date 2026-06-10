package io.teslasync.shared.core.presentation.automations

import io.teslasync.shared.core.data.repo.AutomationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.automationDetailKey
import io.teslasync.shared.core.data.repo.automationHistoryKey
import io.teslasync.shared.core.data.repo.automationListKey
import io.teslasync.shared.core.data.repo.automationPresetKey
import io.teslasync.shared.core.data.repo.automationPresetsKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [AutomationsStore] folds the S7 [AutomationsRepository] into shared,
 * refreshable typed feeds and routes each mutation to the right repository call + the
 * web-faithful targeted refresh — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutomationsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per feed key (so a refresh is
     * observable) and emits Loading→Success with a deterministic value carrying the collection
     * count; every mutation records its argument and succeeds.
     */
    private class FakeAutomationsRepository : AutomationsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val toggled: MutableList<Pair<Long, Boolean>> = mutableListOf()
        val reEnabled: MutableList<Long> = mutableListOf()
        val deleted: MutableList<Long> = mutableListOf()
        val bulk: MutableList<Pair<List<Long>, AutomationBulkOp>> = mutableListOf()
        val testRun: MutableList<Long> = mutableListOf()
        val created: MutableList<AutomationFullInput> = mutableListOf()
        val updated: MutableList<Pair<Long, AutomationFullInput>> = mutableListOf()

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

        override fun automations(): Flow<Resource<List<Automation>>> =
            counting(automationListKey()) { n -> listOf(Automation(id = n.toLong(), name = "a-$n")) }

        override fun automationHistory(limit: Int): Flow<Resource<AutomationHistoryListResponse>> =
            counting(automationHistoryKey(limit)) { n -> AutomationHistoryListResponse(total = n.toLong()) }

        override fun automation(id: Long): Flow<Resource<AutomationFull>> =
            counting(automationDetailKey(id)) { n -> AutomationFull(id = id, name = "full-$n") }

        override fun automationPresets(category: String?): Flow<Resource<AutomationPresetsResponse>> =
            counting(automationPresetsKey(category)) { _ -> AutomationPresetsResponse() }

        override fun automationPreset(id: String): Flow<Resource<AutomationPreset>> =
            counting(automationPresetKey(id)) { _ -> AutomationPreset(id = id, name = "p") }

        override suspend fun toggleAutomation(
            id: Long,
            enabled: Boolean,
        ): Result<ToggleAutomationResult> {
            toggled += id to enabled
            return Result.success(ToggleAutomationResult(id, enabled))
        }

        override suspend fun reEnableAutomation(id: Long): Result<ReEnableAutomationResult> {
            reEnabled += id
            return Result.success(ReEnableAutomationResult(id, enabled = true, autoDisabled = false))
        }

        override suspend fun deleteAutomation(id: Long): Result<Unit> {
            deleted += id
            return Result.success(Unit)
        }

        override suspend fun bulkAutomationsUpdate(
            ids: List<Long>,
            op: AutomationBulkOp,
        ): Result<AutomationBulkResult> {
            bulk += ids to op
            return Result.success(AutomationBulkResult(updated = ids.size))
        }

        override suspend fun testRunAutomation(id: Long): Result<Unit> {
            testRun += id
            return Result.success(Unit)
        }

        override suspend fun createAutomationFull(input: AutomationFullInput): Result<AutomationFull> {
            created += input
            return Result.success(AutomationFull(id = 1, name = input.name))
        }

        override suspend fun updateAutomationFull(
            id: Long,
            input: AutomationFullInput,
        ): Result<AutomationFull> {
            updated += id to input
            return Result.success(AutomationFull(id = id, name = input.name))
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AutomationsStore(FakeAutomationsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<Automation>>>()
            backgroundScope.launch { store.automations().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("a-1", last.data.first().name)
        }

    @Test
    fun sameKeySharesUpstreamAndDistinctKeysAreDistinctFeeds() =
        runTest {
            val store = AutomationsStore(FakeAutomationsRepository(), backgroundScope)
            assertSame(store.automations(), store.automations())
            assertSame(store.automationHistory(20), store.automationHistory(20))
            assertTrue(store.automationHistory(20) !== store.automationHistory(50))
            assertTrue(store.automation(1) !== store.automation(2))
            assertTrue(store.automationPresets() !== store.automationPresets("comfort"))
        }

    @Test
    fun toggleDelegatesAndRefreshesOnlyTheList() =
        runTest {
            val repo = FakeAutomationsRepository()
            val store = AutomationsStore(repo, backgroundScope)
            backgroundScope.launch { store.automations().collect {} }
            backgroundScope.launch { store.automationHistory(20).collect {} }
            backgroundScope.launch { store.automation(9).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[automationListKey()])

            val result = store.toggleAutomation(9, enabled = false)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(9L to false), repo.toggled)
            // Only the list re-fetches; history + detail are untouched (web invalidates list only).
            assertEquals(2, repo.collections[automationListKey()])
            assertEquals(1, repo.collections[automationHistoryKey(20)])
            assertEquals(1, repo.collections[automationDetailKey(9)])
        }

    @Test
    fun deleteRefreshesListAndEveryHistoryLimit() =
        runTest {
            val repo = FakeAutomationsRepository()
            val store = AutomationsStore(repo, backgroundScope)
            backgroundScope.launch { store.automations().collect {} }
            backgroundScope.launch { store.automationHistory(20).collect {} }
            backgroundScope.launch { store.automationHistory(50).collect {} }
            runCurrent()

            val result = store.deleteAutomation(3)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(3L), repo.deleted)
            assertEquals(2, repo.collections[automationListKey()])
            // invalidate `['automation-history']`: BOTH observed limits re-fetch.
            assertEquals(2, repo.collections[automationHistoryKey(20)])
            assertEquals(2, repo.collections[automationHistoryKey(50)])
        }

    @Test
    fun bulkRefreshesListAndHistory() =
        runTest {
            val repo = FakeAutomationsRepository()
            val store = AutomationsStore(repo, backgroundScope)
            backgroundScope.launch { store.automations().collect {} }
            backgroundScope.launch { store.automationHistory(20).collect {} }
            runCurrent()

            val result = store.bulkAutomationsUpdate(listOf(1, 2), AutomationBulkOp.DISABLE)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(listOf(1L, 2L) to AutomationBulkOp.DISABLE), repo.bulk)
            assertEquals(2, repo.collections[automationListKey()])
            assertEquals(2, repo.collections[automationHistoryKey(20)])
        }

    @Test
    fun testRunRefreshesHistoryOnlyNotList() =
        runTest {
            val repo = FakeAutomationsRepository()
            val store = AutomationsStore(repo, backgroundScope)
            backgroundScope.launch { store.automations().collect {} }
            backgroundScope.launch { store.automationHistory(20).collect {} }
            runCurrent()

            val result = store.testRunAutomation(4)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(4L), repo.testRun)
            // History re-fetches; the list does NOT (web invalidates history only).
            assertEquals(1, repo.collections[automationListKey()])
            assertEquals(2, repo.collections[automationHistoryKey(20)])
        }

    @Test
    fun createRefreshesListAndReEnableToo() =
        runTest {
            val repo = FakeAutomationsRepository()
            val store = AutomationsStore(repo, backgroundScope)
            backgroundScope.launch { store.automations().collect {} }
            runCurrent()

            val input = AutomationFullInput(name = "New")
            store.createAutomationFull(input)
            runCurrent()
            assertEquals(listOf(input), repo.created)
            assertEquals(2, repo.collections[automationListKey()])

            store.reEnableAutomation(7)
            runCurrent()
            assertEquals(listOf(7L), repo.reEnabled)
            assertEquals(3, repo.collections[automationListKey()])
        }

    @Test
    fun updateRefreshesListAndOnlyThatDetail() =
        runTest {
            val repo = FakeAutomationsRepository()
            val store = AutomationsStore(repo, backgroundScope)
            backgroundScope.launch { store.automations().collect {} }
            backgroundScope.launch { store.automation(5).collect {} }
            backgroundScope.launch { store.automation(6).collect {} }
            runCurrent()

            val input = AutomationFullInput(name = "Edited")
            val result = store.updateAutomationFull(5, input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L to input), repo.updated)
            assertEquals(2, repo.collections[automationListKey()])
            assertEquals(2, repo.collections[automationDetailKey(5)])
            // A different automation's detail is NOT refreshed.
            assertEquals(1, repo.collections[automationDetailKey(6)])
        }

    @Test
    fun refreshIsNoOpWhenNothingObserved() =
        runTest {
            val repo = FakeAutomationsRepository()
            val store = AutomationsStore(repo, backgroundScope)

            val result = store.deleteAutomation(1)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.deleted.size)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
