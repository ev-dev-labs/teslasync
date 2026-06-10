package io.teslasync.shared.core.presentation.sharing

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SharingRepository
import io.teslasync.shared.core.data.repo.shareLinksCacheKey
import io.teslasync.shared.core.data.repo.sharedDriveCacheKey
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
 * Verifies the S8 [SharingStore] folds the S7 [SharingRepository] into shared, refreshable feeds and
 * routes each mutation to the right repository call + a per-drive refresh — using a fake repository,
 * so no network or cache is involved. The invalidation granularity (only the affected drive's
 * share-link feed; never the public report; never another drive) is the behaviour under test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SharingStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections per key (so a refresh is observable) and
     * emits Loading→Success with a deterministic payload; each mutation records its arguments and
     * succeeds.
     */
    private class FakeSharingRepository : SharingRepository {
        val shareLinkCollections: MutableMap<String, Int> = mutableMapOf()
        val sharedDriveCollections: MutableMap<String, Int> = mutableMapOf()
        val created: MutableList<Pair<String, CreateShareRequest>> = mutableListOf()
        val revoked: MutableList<Pair<String, String>> = mutableListOf()

        override fun shareLinks(driveId: String): Flow<Resource<List<ShareToken>>> =
            flow {
                val key = shareLinksCacheKey(driveId)
                val n = (shareLinkCollections[key] ?: 0) + 1
                shareLinkCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(tokenRow(driveId, n)), fetchedAt = 1L, stale = false))
            }

        override fun sharedDrive(token: String): Flow<Resource<SharedDrive>> =
            flow {
                val key = sharedDriveCacheKey(token)
                val n = (sharedDriveCollections[key] ?: 0) + 1
                sharedDriveCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = sharedDriveRow("report-$token"), fetchedAt = 1L, stale = false))
            }

        override suspend fun createShareLink(
            driveId: String,
            request: CreateShareRequest,
        ): Result<CreateShareResponse> {
            created += driveId to request
            return Result.success(CreateShareResponse(token = "tok-$driveId", url = "https://x/$driveId", id = 1))
        }

        override suspend fun revokeShareLink(
            driveId: String,
            token: String,
        ): Result<Unit> {
            revoked += driveId to token
            return Result.success(Unit)
        }

        companion object {
            fun tokenRow(
                driveId: String,
                n: Int,
            ): ShareToken =
                ShareToken(
                    id = n.toLong(),
                    token = "tok-$driveId-$n",
                    driveId = driveId.toLongOrNull() ?: 0L,
                    includeMap = true,
                    includeTelemetry = false,
                    includeSpeed = true,
                    views = 0,
                    createdAt = "2026-01-01T00:00:00Z",
                )

            fun sharedDriveRow(title: String): SharedDrive =
                SharedDriveData(
                    payloadVersion = "v2",
                    title = title,
                    description = "",
                    drive =
                        SharedDriveInfo(
                            date = "2026-01-01",
                            distanceM = 1000.0,
                            durationS = 600.0,
                            startAddress = "A",
                            endAddress = "B",
                        ),
                )
        }
    }

    @Test
    fun shareLinksReadEmitsCacheThenNetwork() =
        runTest {
            val store = SharingStore(FakeSharingRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<ShareToken>>>()
            backgroundScope.launch { store.shareLinks("42").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(1, last.data.size)
        }

    @Test
    fun sharedDriveReadEmitsCacheThenNetwork() =
        runTest {
            val store = SharingStore(FakeSharingRepository(), backgroundScope)
            val seen = mutableListOf<Resource<SharedDrive>>()
            backgroundScope.launch { store.sharedDrive("abc").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals("report-abc", (last.data as SharedDriveData).title)
        }

    @Test
    fun sameDriveSharesUpstreamAndDistinctDrivesAreDistinctFeeds() =
        runTest {
            val store = SharingStore(FakeSharingRepository(), backgroundScope)
            assertSame(store.shareLinks("42"), store.shareLinks("42"))
            assertNotSame(store.shareLinks("42"), store.shareLinks("43"))
        }

    @Test
    fun sameTokenSharesUpstreamAndDistinctTokensAreDistinctFeeds() =
        runTest {
            val store = SharingStore(FakeSharingRepository(), backgroundScope)
            assertSame(store.sharedDrive("t1"), store.sharedDrive("t1"))
            assertNotSame(store.sharedDrive("t1"), store.sharedDrive("t2"))
        }

    @Test
    fun createDelegatesAndRefreshesOnlyThatDriveFeed() =
        runTest {
            val repo = FakeSharingRepository()
            val store = SharingStore(repo, backgroundScope)
            backgroundScope.launch { store.shareLinks("42").collect {} }
            backgroundScope.launch { store.shareLinks("99").collect {} }
            runCurrent()
            assertEquals(1, repo.shareLinkCollections[shareLinksCacheKey("42")])
            assertEquals(1, repo.shareLinkCollections[shareLinksCacheKey("99")])

            val req = CreateShareRequest(title = "My drive", includeSpeed = true)
            val result = store.createShareLink("42", req)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42" to req), repo.created)
            // Only drive 42's feed re-fetched; drive 99 is untouched.
            assertEquals(2, repo.shareLinkCollections[shareLinksCacheKey("42")])
            assertEquals(1, repo.shareLinkCollections[shareLinksCacheKey("99")])
        }

    @Test
    fun revokeDelegatesAndRefreshesOnlyThatDriveFeed() =
        runTest {
            val repo = FakeSharingRepository()
            val store = SharingStore(repo, backgroundScope)
            backgroundScope.launch { store.shareLinks("42").collect {} }
            runCurrent()
            assertEquals(1, repo.shareLinkCollections[shareLinksCacheKey("42")])

            val result = store.revokeShareLink("42", "tok-xyz")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42" to "tok-xyz"), repo.revoked)
            assertEquals(2, repo.shareLinkCollections[shareLinksCacheKey("42")])
        }

    @Test
    fun mutationDoesNotRefreshThePublicReportFeed() =
        runTest {
            val repo = FakeSharingRepository()
            val store = SharingStore(repo, backgroundScope)
            backgroundScope.launch { store.sharedDrive("tok-xyz").collect {} }
            runCurrent()
            assertEquals(1, repo.sharedDriveCollections[sharedDriveCacheKey("tok-xyz")])

            store.createShareLink("42", CreateShareRequest())
            store.revokeShareLink("42", "tok-xyz")
            runCurrent()

            // The public report feed is never invalidated by a mutation (web never invalidates
            // sharingKeys.shared).
            assertEquals(1, repo.sharedDriveCollections[sharedDriveCacheKey("tok-xyz")])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeSharingRepository()
            val store = SharingStore(repo, backgroundScope)

            val result = store.createShareLink("42", CreateShareRequest())
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.created.size)
            assertTrue(repo.shareLinkCollections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
