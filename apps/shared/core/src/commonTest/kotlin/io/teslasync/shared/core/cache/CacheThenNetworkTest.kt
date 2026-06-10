package io.teslasync.shared.core.cache

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.runTestBlocking
import kotlinx.coroutines.flow.toList
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CacheThenNetworkTest {
    private val fresh = Reading(distanceM = 1_000.0, durationS = 60)
    private val cached = Reading(distanceM = 500.0, durationS = 30)

    @Test
    fun emitsCachedLoadingThenNetworkSuccessInOrder() =
        runTestBlocking {
            val clock = FakeClock(now = 0L)
            val repo = ReadingRepository(newTestCache().store, clock)
            repo.seed("k", cached)
            clock.now = 100L

            val emissions = repo.stream("k") { fresh }.toList()

            assertEquals(2, emissions.size)
            val loading = assertIs<Resource.Loading<Reading>>(emissions[0])
            assertEquals(cached, loading.cached)
            assertEquals(0L, loading.fetchedAt)
            assertFalse(loading.stale)
            val success = assertIs<Resource.Success<Reading>>(emissions[1])
            assertEquals(fresh, success.data)
            assertEquals(100L, success.fetchedAt)
            assertFalse(success.stale)
        }

    @Test
    fun coldStartWithNoCacheEmitsEmptyLoadingThenSuccess() =
        runTestBlocking {
            val clock = FakeClock(now = 42L)
            val repo = ReadingRepository(newTestCache().store, clock)

            val emissions = repo.stream("missing") { fresh }.toList()

            val loading = assertIs<Resource.Loading<Reading>>(emissions[0])
            assertNull(loading.cached)
            assertNull(loading.fetchedAt)
            assertFalse(loading.stale)
            assertEquals(fresh, assertIs<Resource.Success<Reading>>(emissions[1]).data)
        }

    @Test
    fun freshCacheIsNotFlaggedStale() =
        runTestBlocking {
            val clock = FakeClock(now = 0L)
            val repo = ReadingRepository(newTestCache().store, clock)
            repo.seed("k", cached)
            // Within the 5-minute Energy TTL.
            clock.now = repo.ttl - 1

            val loading = assertIs<Resource.Loading<Reading>>(repo.stream("k") { fresh }.toList()[0])

            assertFalse(loading.stale)
        }

    @Test
    fun cacheOlderThanTtlIsFlaggedStale() =
        runTestBlocking {
            val clock = FakeClock(now = 0L)
            val repo = ReadingRepository(newTestCache().store, clock)
            repo.seed("k", cached)
            // One millisecond past the TTL boundary (staleness is strictly `> ttl`).
            clock.now = repo.ttl + 1

            val loading = assertIs<Resource.Loading<Reading>>(repo.stream("k") { fresh }.toList()[0])

            assertTrue(loading.stale)
        }

    @Test
    fun staleBoundaryIsExclusive() =
        runTestBlocking {
            val clock = FakeClock(now = 0L)
            val repo = ReadingRepository(newTestCache().store, clock)
            repo.seed("k", cached)
            // Age exactly equal to the TTL is NOT stale.
            clock.now = repo.ttl

            val loading = assertIs<Resource.Loading<Reading>>(repo.stream("k") { fresh }.toList()[0])

            assertFalse(loading.stale)
        }

    @Test
    fun offlineServesCachedValueFlaggedStale() =
        runTestBlocking {
            val clock = FakeClock(now = 10L)
            val repo = ReadingRepository(newTestCache().store, clock)
            repo.seed("k", cached)
            clock.now = 20L

            val emissions = repo.stream("k") { error("offline") }.toList()

            assertEquals(2, emissions.size)
            assertIs<Resource.Loading<Reading>>(emissions[0])
            val errored = assertIs<Resource.Error<Reading>>(emissions[1])
            assertEquals(cached, errored.cached)
            assertEquals(10L, errored.fetchedAt)
            assertTrue(errored.stale)
            assertTrue(errored.error.message?.contains("offline") == true)
        }

    @Test
    fun offlineWithoutCacheEmitsErrorWithNullCache() =
        runTestBlocking {
            val clock = FakeClock(now = 0L)
            val repo = ReadingRepository(newTestCache().store, clock)

            val emissions = repo.stream("missing") { error("offline") }.toList()

            assertNull(assertIs<Resource.Loading<Reading>>(emissions[0]).cached)
            val errored = assertIs<Resource.Error<Reading>>(emissions[1])
            assertNull(errored.cached)
            assertFalse(errored.stale)
        }

    @Test
    fun successWritesThroughWithClockStamp() =
        runTestBlocking {
            val clock = FakeClock(now = 500L)
            val store = newTestCache().store
            val repo = ReadingRepository(store, clock)

            repo.stream("k") { fresh }.toList()

            val persisted = repo.peek("k")
            assertEquals(fresh, persisted?.data)
            assertEquals(500L, persisted?.fetchedAt)
        }

    @Test
    fun corruptCachedPayloadIsEvictedAndNetworkStillRefreshes() =
        runTestBlocking {
            val store = MapCacheStore()
            // A payload that cannot decode into Reading (shape drift / corruption).
            store.putRaw(CacheDomain.Energy, "k", "{not valid json", fetchedAt = 0L)
            val repo = ReadingRepository(store, FakeClock(now = 100L))

            val emissions = repo.stream("k") { fresh }.toList()

            // Corrupt row is treated as a miss, so Loading carries no cached value...
            assertNull(assertIs<Resource.Loading<Reading>>(emissions[0]).cached)
            // ...the network refresh still succeeds and overwrites the bad row.
            assertEquals(fresh, assertIs<Resource.Success<Reading>>(emissions[1]).data)
            assertEquals(fresh, repo.peek("k")?.data)
        }

    @Test
    fun cacheWriteFailureStillEmitsFreshData() =
        runTestBlocking {
            val store = MapCacheStore().apply { failWrites = true }
            val repo = ReadingRepository(store, FakeClock(now = 0L))

            val emissions = repo.stream("k") { fresh }.toList()

            // A failed persistence must not hide freshly fetched data.
            val success = assertIs<Resource.Success<Reading>>(emissions[1])
            assertEquals(fresh, success.data)
        }

    @Test
    fun cancellationPropagatesAndIsNotReportedAsError() =
        runTestBlocking {
            val repo = ReadingRepository(MapCacheStore(), FakeClock(now = 0L))

            assertFailsWith<CancellationException> {
                repo.stream("k") { throw CancellationException("cancelled") }.toList()
            }
        }
}
