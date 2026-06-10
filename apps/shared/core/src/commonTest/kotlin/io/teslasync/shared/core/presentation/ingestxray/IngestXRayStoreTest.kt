package io.teslasync.shared.core.presentation.ingestxray

import io.teslasync.shared.core.data.repo.IngestXRayRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.ingestXRayKey
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
 * Verifies the S8 [IngestXRayStore] folds the S7 [IngestXRayRepository] into per-param shared,
 * refreshable feeds — using a fake repository, so no network or cache is involved. Mirrors the web
 * `useIngestXRay` hook: one parameterized read, no mutations.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class IngestXRayStoreTest {
    /**
     * Fake S7 port: counts collections per `(vehicleId, window, bucket, limit)` key (so a refresh is
     * observable) and emits Loading→Success, stamping the emitted snapshot's [IngestXRayResponse.totalSamples]
     * with the per-key collection count.
     */
    private class FakeIngestXRayRepository : IngestXRayRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()

        override fun xray(
            vehicleId: Long,
            window: IngestXRayWindow,
            bucket: IngestXRayBucket,
            limit: Int,
        ): Flow<Resource<IngestXRayResponse>> =
            flow {
                val key = ingestXRayKey(vehicleId, window, bucket, limit)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            IngestXRayResponse(
                                vehicleId = vehicleId,
                                window = window.wire,
                                bucket = bucket.wire,
                                totalSamples = n.toLong(),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = IngestXRayStore(FakeIngestXRayRepository(), backgroundScope)
            val seen = mutableListOf<Resource<IngestXRayResponse>>()
            backgroundScope.launch { store.xray(7L).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(7L, last.data.vehicleId)
            assertEquals("1h", last.data.window, "default window is 1h (web useIngestXRay default)")
            assertEquals("1m", last.data.bucket, "default bucket is 1m (web useIngestXRay default)")
        }

    @Test
    fun sameParamsShareFeedDistinctParamsDoNot() =
        runTest {
            val store = IngestXRayStore(FakeIngestXRayRepository(), backgroundScope)
            assertSame(store.xray(7L), store.xray(7L), "same params fold into one shared feed")
            assertNotSame(
                store.xray(7L),
                store.xray(7L, window = IngestXRayWindow.W24H),
                "a different window keys a distinct feed",
            )
            assertNotSame(store.xray(7L), store.xray(8L), "a different vehicle keys a distinct feed")
        }

    @Test
    fun feedCollectsExactlyOnceWhileObserved() =
        runTest {
            val repo = FakeIngestXRayRepository()
            val store = IngestXRayStore(repo, backgroundScope)
            backgroundScope.launch { store.xray(7L).collect {} }
            backgroundScope.launch { store.xray(7L).collect {} }
            runCurrent()

            // Two observers of the one shared feed fold into a single upstream collection.
            assertEquals(1, repo.collections[ingestXRayKey(7L, IngestXRayWindow.W1H, IngestXRayBucket.B1M, 50)])
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeIngestXRayRepository()
            val store = IngestXRayStore(repo, backgroundScope)
            val key = ingestXRayKey(7L, IngestXRayWindow.W1H, IngestXRayBucket.B1M, 50)
            backgroundScope.launch { store.xray(7L).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[key])

            store.refresh(7L)
            runCurrent()

            assertEquals(2, repo.collections[key], "refresh re-collects the matching feed")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeIngestXRayRepository()
            val store = IngestXRayStore(repo, backgroundScope)

            store.refresh(7L)
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no observer ⇒ no upstream restart")
        }

    @Test
    fun refreshOnlyTouchesTheMatchingParamFeed() =
        runTest {
            val repo = FakeIngestXRayRepository()
            val store = IngestXRayStore(repo, backgroundScope)
            val keyA = ingestXRayKey(7L, IngestXRayWindow.W1H, IngestXRayBucket.B1M, 50)
            val keyB = ingestXRayKey(7L, IngestXRayWindow.W24H, IngestXRayBucket.B1M, 50)
            backgroundScope.launch { store.xray(7L).collect {} }
            backgroundScope.launch { store.xray(7L, window = IngestXRayWindow.W24H).collect {} }
            runCurrent()

            store.refresh(7L)
            runCurrent()

            assertEquals(2, repo.collections[keyA], "the 1h feed was refreshed")
            assertEquals(1, repo.collections[keyB], "the 24h feed was left untouched")
        }
}
