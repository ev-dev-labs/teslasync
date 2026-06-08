package io.teslasync.shared.core.presentation.watch

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.WatchRepository
import io.teslasync.shared.core.data.repo.watchComplicationCacheKey
import io.teslasync.shared.core.data.repo.watchSummaryCacheKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [WatchStore] folds the S7 [WatchRepository] into shared, refreshable feeds and routes
 * the command to the right repository call — using a fake repository, so no network or cache is
 * involved. The per-vehicle feed sharing, the cache→network emission, the command forwarding, and the
 * web-faithful "command invalidates nothing" behaviour are the behaviours under test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WatchStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections per key (so a refresh is observable) and emits
     * Loading→Success with a deterministic payload; the command records its arguments and succeeds (or
     * fails, when [commandFails] is set).
     */
    private class FakeWatchRepository(
        val commandFails: Boolean = false,
        val commandSuccessFlag: Boolean = true,
    ) : WatchRepository {
        val summaryCollections: MutableMap<String, Int> = mutableMapOf()
        val complicationCollections: MutableMap<String, Int> = mutableMapOf()
        val commands: MutableList<Pair<Long?, String>> = mutableListOf()

        override fun watchSummary(vehicleId: Long?): Flow<Resource<WatchSummary>> =
            flow {
                val key = watchSummaryCacheKey(vehicleId)
                val n = (summaryCollections[key] ?: 0) + 1
                summaryCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data = WatchSummary(vehicleName = "Bolt-$n", state = "online", batteryLevel = 72.0),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override fun watchComplication(vehicleId: Long?): Flow<Resource<WatchComplication>> =
            flow {
                val key = watchComplicationCacheKey(vehicleId)
                val n = (complicationCollections[key] ?: 0) + 1
                complicationCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data = WatchComplication(battery = "72%", range = "300 km", state = "online", charging = false),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override suspend fun sendWatchCommand(
            vehicleId: Long?,
            command: String,
        ): Result<WatchCommandResult> {
            commands += vehicleId to command
            return if (commandFails) {
                Result.failure(IllegalStateException("boom"))
            } else {
                Result.success(WatchCommandResult(success = commandSuccessFlag, message = "ok"))
            }
        }
    }

    @Test
    fun summaryReadEmitsCacheThenNetwork() =
        runTest {
            val store = WatchStore(FakeWatchRepository(), backgroundScope)
            val seen = mutableListOf<Resource<WatchSummary>>()
            backgroundScope.launch { store.watchSummary(42L).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("online", last.data.state)
            assertEquals(72.0, last.data.batteryLevel)
        }

    @Test
    fun complicationReadEmitsCacheThenNetwork() =
        runTest {
            val store = WatchStore(FakeWatchRepository(), backgroundScope)
            val seen = mutableListOf<Resource<WatchComplication>>()
            backgroundScope.launch { store.watchComplication(42L).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals("72%", last.data.battery)
            assertEquals("300 km", last.data.range)
        }

    @Test
    fun sameVehicleSharesUpstreamAndDistinctVehiclesAreDistinctFeeds() =
        runTest {
            val store = WatchStore(FakeWatchRepository(), backgroundScope)
            assertSame(store.watchSummary(42L), store.watchSummary(42L))
            assertNotSame(store.watchSummary(42L), store.watchSummary(43L))
            assertSame(store.watchComplication(42L), store.watchComplication(42L))
            assertNotSame(store.watchComplication(42L), store.watchComplication(43L))
            // The null ("primary vehicle") feed is its own distinct upstream.
            assertSame(store.watchSummary(null), store.watchSummary())
            assertNotSame(store.watchSummary(null), store.watchSummary(1L))
        }

    @Test
    fun refreshReCollectsOnlyTheTargetFeed() =
        runTest {
            val repo = FakeWatchRepository()
            val store = WatchStore(repo, backgroundScope)
            backgroundScope.launch { store.watchSummary(42L).collect {} }
            backgroundScope.launch { store.watchSummary(99L).collect {} }
            backgroundScope.launch { store.watchComplication(42L).collect {} }
            runCurrent()
            assertEquals(1, repo.summaryCollections[watchSummaryCacheKey(42L)])
            assertEquals(1, repo.summaryCollections[watchSummaryCacheKey(99L)])
            assertEquals(1, repo.complicationCollections[watchComplicationCacheKey(42L)])

            store.refreshSummary(42L)
            runCurrent()

            assertEquals(2, repo.summaryCollections[watchSummaryCacheKey(42L)], "only vehicle 42's summary re-fetched")
            assertEquals(1, repo.summaryCollections[watchSummaryCacheKey(99L)], "vehicle 99's summary untouched")
            assertEquals(1, repo.complicationCollections[watchComplicationCacheKey(42L)], "complication untouched")
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeWatchRepository()
            val store = WatchStore(repo, backgroundScope)

            store.refreshSummary(42L)
            store.refreshComplication(42L)
            runCurrent()

            assertTrue(repo.summaryCollections.isEmpty(), "no summary feed observed ⇒ no needless restart")
            assertTrue(repo.complicationCollections.isEmpty(), "no complication feed observed ⇒ no needless restart")
        }

    @Test
    fun commandForwardsArgumentsReturnsResultAndRefreshesNothing() =
        runTest {
            val repo = FakeWatchRepository()
            val store = WatchStore(repo, backgroundScope)
            backgroundScope.launch { store.watchSummary(42L).collect {} }
            backgroundScope.launch { store.watchComplication(42L).collect {} }
            runCurrent()

            val result = store.sendWatchCommand("flash_lights", vehicleId = 42L)
            runCurrent()

            assertTrue(result.isSuccess)
            assertTrue(result.getOrThrow().success)
            val expectedCommands: List<Pair<Long?, String>> = listOf(42L to "flash_lights")
            assertEquals(expectedCommands, repo.commands)
            // The web mutation invalidates nothing on success — neither feed re-collects.
            assertEquals(1, repo.summaryCollections[watchSummaryCacheKey(42L)])
            assertEquals(1, repo.complicationCollections[watchComplicationCacheKey(42L)])
        }

    @Test
    fun commandDefaultsToNullVehicleAndSurfacesInBandRejection() =
        runTest {
            val repo = FakeWatchRepository(commandSuccessFlag = false)
            val store = WatchStore(repo, backgroundScope)

            val result = store.sendWatchCommand("honk")
            runCurrent()

            // A transport success can still carry success=false (the backend rejected the command).
            assertTrue(result.isSuccess)
            assertTrue(!result.getOrThrow().success)
            val expectedCommands: List<Pair<Long?, String>> = listOf(null to "honk")
            assertEquals(expectedCommands, repo.commands)
        }

    @Test
    fun failedCommandSurfacesFailureAndRefreshesNothing() =
        runTest {
            val repo = FakeWatchRepository(commandFails = true)
            val store = WatchStore(repo, backgroundScope)
            backgroundScope.launch { store.watchSummary(42L).collect {} }
            runCurrent()

            val result = store.sendWatchCommand("flash_lights", vehicleId = 42L)
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.summaryCollections[watchSummaryCacheKey(42L)], "a failed command never refreshes")
        }
}
