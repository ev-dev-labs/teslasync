package io.teslasync.shared.core.presentation.commands

import io.teslasync.shared.core.data.repo.CommandsRepository
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
 * Verifies the S8 [CommandsStore] folds the S7 [CommandsRepository] into two shared, refreshable
 * feeds — using a fake repository, so no network or cache is involved. Mirrors the web `useCommands`
 * hooks: two reads keyed by `vehicleId` (`useCommandHistory`, `useCommandLatest`), no mutations, and
 * the `enabled: !!vehicleId` gate on each.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandsStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections (so a refresh is observable) under a
     * feed-prefixed label, and emits Loading→Success.
     */
    private class FakeCommandsRepository : CommandsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        override fun commandHistory(vehicleId: String): Flow<Resource<JsonElement>> = feed("history:$vehicleId")

        override fun commandLatest(vehicleId: String): Flow<Resource<JsonElement>> = feed("latest:$vehicleId")

        private fun feed(label: String): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }
    }

    @Test
    fun historyEmitsCacheThenNetwork() =
        runTest {
            val store = CommandsStore(FakeCommandsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.commandHistory("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("history:7#1", last.data.toString().trim('"'))
        }

    @Test
    fun latestEmitsCacheThenNetwork() =
        runTest {
            val store = CommandsStore(FakeCommandsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.commandLatest("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals("latest:7#1", last.data.toString().trim('"'))
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = CommandsStore(FakeCommandsRepository(), backgroundScope)
            assertSame(store.commandHistory("7"), store.commandHistory("7"))
            assertSame(store.commandLatest("7"), store.commandLatest("7"))
        }

    @Test
    fun historyAndLatestAreDistinctFeedsAndTargetTheirOwnKeys() =
        runTest {
            val repo = FakeCommandsRepository()
            val store = CommandsStore(repo, backgroundScope)
            backgroundScope.launch { store.commandHistory("7").collect {} }
            backgroundScope.launch { store.commandLatest("7").collect {} }
            backgroundScope.launch { store.commandHistory("9").collect {} }
            runCurrent()

            assertEquals(1, repo.collections["history:7"])
            assertEquals(1, repo.collections["latest:7"])
            assertEquals(1, repo.collections["history:9"])
            // Same vehicle, different read ⇒ distinct feeds; different vehicle ⇒ distinct feeds.
            assertTrue(store.commandHistory("7") !== store.commandLatest("7"))
            assertTrue(store.commandHistory("7") !== store.commandHistory("9"))
        }

    @Test
    fun refreshReFetchesTheObservedFeeds() =
        runTest {
            val repo = FakeCommandsRepository()
            val store = CommandsStore(repo, backgroundScope)
            backgroundScope.launch { store.commandHistory("7").collect {} }
            backgroundScope.launch { store.commandLatest("7").collect {} }
            runCurrent()
            assertEquals(1, repo.collections["history:7"])
            assertEquals(1, repo.collections["latest:7"])

            store.refreshCommandHistory("7")
            store.refreshCommandLatest("7")
            runCurrent()

            assertEquals(2, repo.collections["history:7"], "refresh re-collects the history feed")
            assertEquals(2, repo.collections["latest:7"], "refresh re-collects the latest feed")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeCommandsRepository()
            val store = CommandsStore(repo, backgroundScope)

            store.refreshCommandHistory("7")
            store.refreshCommandLatest("7")
            runCurrent()

            assertEquals(null, repo.collections["history:7"])
            assertEquals(null, repo.collections["latest:7"])
        }

    @Test
    fun disabledFeedsNeverFetchAndStayLoading() =
        runTest {
            val repo = FakeCommandsRepository()
            val store = CommandsStore(repo, backgroundScope)

            val seen = mutableListOf<Resource<JsonElement>>()
            for (vid in listOf<String?>(null, "")) {
                val history = store.commandHistory(vid)
                val latest = store.commandLatest(vid)
                backgroundScope.launch { history.collect { seen += it } }
                backgroundScope.launch { latest.collect { seen += it } }
            }
            runCurrent()

            // vehicleId null/blank ⇒ no repository call, feeds stay at the initial Loading slot
            // (web `enabled: !!vehicleId`).
            assertTrue(repo.collections.isEmpty())
            assertTrue(seen.all { it is Resource.Loading })
            // The disabled feed is the same stable instance regardless of the falsy id.
            assertSame(store.commandHistory(null), store.commandHistory(""))
            assertSame(store.commandLatest(null), store.commandLatest(""))
            // ...and the two reads do not share a disabled instance.
            assertTrue(store.commandHistory(null) !== store.commandLatest(null))
        }

    @Test
    fun refreshIsNoOpForADisabledFeed() =
        runTest {
            val repo = FakeCommandsRepository()
            val store = CommandsStore(repo, backgroundScope)
            backgroundScope.launch { store.commandHistory(null).collect {} }
            backgroundScope.launch { store.commandLatest("").collect {} }
            runCurrent()

            store.refreshCommandHistory(null)
            store.refreshCommandLatest("")
            runCurrent()

            assertTrue(repo.collections.isEmpty())
        }
}
