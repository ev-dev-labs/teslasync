package io.teslasync.shared.core.presentation.vehiclephoto

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclePhotoRepository
import io.teslasync.shared.core.data.repo.vehiclePhotoCacheKey
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
 * Verifies the S8 [VehiclePhotoStore] folds the S7 [VehiclePhotoRepository] into a shared,
 * refreshable feed and routes each mutation to the right repository call + the right per-vehicle
 * refresh + the cross-domain [VehiclePhotoStore]`.onVehicleChanged` hook — using a fake repository,
 * so no network or cache is involved. The upload's client-side validation short-circuit (an invalid
 * file never reaching the repository) and the per-vehicle invalidation granularity are the
 * behaviours under test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclePhotoStoreTest {
    /**
     * Fake S7 port: the read re-counts its collections per key (so a refresh is observable) and emits
     * Loading→Success with a deterministic meta; each mutation records its arguments and succeeds
     * (or fails, when [uploadFails] is set).
     */
    private class FakeVehiclePhotoRepository(
        val uploadFails: Boolean = false,
    ) : VehiclePhotoRepository {
        val photoCollections: MutableMap<String, Int> = mutableMapOf()
        val uploaded: MutableList<Triple<String, Int, String?>> = mutableListOf()
        val deleted: MutableList<String> = mutableListOf()

        override fun vehiclePhoto(vehicleId: String): Flow<Resource<VehiclePhotoMeta>> =
            flow {
                val key = vehiclePhotoCacheKey(vehicleId)
                val n = (photoCollections[key] ?: 0) + 1
                photoCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data = VehiclePhotoMeta(hasPhoto = true, uploadedAt = "2026-06-01T00:00:0${n}Z"),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override suspend fun uploadVehiclePhoto(
            vehicleId: String,
            bytes: ByteArray,
            fileName: String,
            mimeType: String?,
        ): Result<VehiclePhotoMeta> {
            uploaded += Triple(vehicleId, bytes.size, mimeType)
            return if (uploadFails) {
                Result.failure(IllegalStateException("boom"))
            } else {
                Result.success(VehiclePhotoMeta(hasPhoto = true, uploadedAt = "2026-06-02T00:00:00Z"))
            }
        }

        override suspend fun deleteVehiclePhoto(vehicleId: String): Result<Unit> {
            deleted += vehicleId
            return Result.success(Unit)
        }
    }

    private val pngBytes = ByteArray(16) { 1 }

    @Test
    fun vehiclePhotoReadEmitsCacheThenNetwork() =
        runTest {
            val store = VehiclePhotoStore(FakeVehiclePhotoRepository(), backgroundScope)
            val seen = mutableListOf<Resource<VehiclePhotoMeta>>()
            backgroundScope.launch { store.vehiclePhoto("42").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertTrue(last.data.hasPhoto)
        }

    @Test
    fun sameVehicleSharesUpstreamAndDistinctVehiclesAreDistinctFeeds() =
        runTest {
            val store = VehiclePhotoStore(FakeVehiclePhotoRepository(), backgroundScope)
            assertSame(store.vehiclePhoto("42"), store.vehiclePhoto("42"))
            assertNotSame(store.vehiclePhoto("42"), store.vehiclePhoto("43"))
        }

    @Test
    fun uploadDelegatesRefreshesOnlyThatFeedAndFiresVehicleChanged() =
        runTest {
            val repo = FakeVehiclePhotoRepository()
            val changed = mutableListOf<String>()
            val store = VehiclePhotoStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehiclePhoto("42").collect {} }
            backgroundScope.launch { store.vehiclePhoto("99").collect {} }
            runCurrent()
            assertEquals(1, repo.photoCollections[vehiclePhotoCacheKey("42")])
            assertEquals(1, repo.photoCollections[vehiclePhotoCacheKey("99")])

            val result = store.uploadVehiclePhoto("42", pngBytes, "hero.png", "image/png")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple<String, Int, String?>("42", pngBytes.size, "image/png")), repo.uploaded)
            // Only vehicle 42's feed re-fetched; vehicle 99 untouched.
            assertEquals(2, repo.photoCollections[vehiclePhotoCacheKey("42")])
            assertEquals(1, repo.photoCollections[vehiclePhotoCacheKey("99")])
            assertEquals(listOf("42"), changed)
        }

    @Test
    fun uploadRejectsEmptyFileWithoutCallingRepo() =
        runTest {
            val repo = FakeVehiclePhotoRepository()
            val changed = mutableListOf<String>()
            val store = VehiclePhotoStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehiclePhoto("42").collect {} }
            runCurrent()

            val result = store.uploadVehiclePhoto("42", ByteArray(0), "empty.png", "image/png")
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals("Selected file is empty.", result.exceptionOrNull()?.message)
            assertTrue(repo.uploaded.isEmpty(), "an invalid file never reaches the network")
            assertEquals(1, repo.photoCollections[vehiclePhotoCacheKey("42")], "no feed refresh on a rejected upload")
            assertTrue(changed.isEmpty())
        }

    @Test
    fun uploadRejectsUnsupportedMimeWithoutCallingRepo() =
        runTest {
            val repo = FakeVehiclePhotoRepository()
            val store = VehiclePhotoStore(repo, backgroundScope)

            val result = store.uploadVehiclePhoto("42", pngBytes, "x.gif", "image/gif")
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals("Unsupported image type: image/gif", result.exceptionOrNull()?.message)
            assertTrue(repo.uploaded.isEmpty())
        }

    @Test
    fun failedUploadRefreshesNothingAndDoesNotFireVehicleChanged() =
        runTest {
            val repo = FakeVehiclePhotoRepository(uploadFails = true)
            val changed = mutableListOf<String>()
            val store = VehiclePhotoStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehiclePhoto("42").collect {} }
            runCurrent()

            val result = store.uploadVehiclePhoto("42", pngBytes, "hero.png", "image/png")
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(listOf(Triple<String, Int, String?>("42", pngBytes.size, "image/png")), repo.uploaded)
            assertEquals(1, repo.photoCollections[vehiclePhotoCacheKey("42")], "a failed upload never refreshes the feed")
            assertTrue(changed.isEmpty())
        }

    @Test
    fun deleteDelegatesRefreshesThatFeedAndFiresVehicleChanged() =
        runTest {
            val repo = FakeVehiclePhotoRepository()
            val changed = mutableListOf<String>()
            val store = VehiclePhotoStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehiclePhoto("42").collect {} }
            runCurrent()

            val result = store.deleteVehiclePhoto("42")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42"), repo.deleted)
            assertEquals(2, repo.photoCollections[vehiclePhotoCacheKey("42")])
            assertEquals(listOf("42"), changed)
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeVehiclePhotoRepository()
            val store = VehiclePhotoStore(repo, backgroundScope)

            store.refreshPhotoFeed("42")
            runCurrent()

            assertTrue(repo.photoCollections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
