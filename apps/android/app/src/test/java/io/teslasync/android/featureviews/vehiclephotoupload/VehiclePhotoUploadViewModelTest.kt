package io.teslasync.android.featureviews.vehiclephotoupload

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Drives [VehiclePhotoUploadViewModel] over a controllable fake [VehiclePhotoUploadSource], covering the
 * cache-then-network state matrix the photo read can be in (loading / content / hard error + retry /
 * stale-offline + retry), both mutations' typed [PhotoToast] + the exact bytes/name/MIME the upload forwards,
 * the surfaced backend/validation reason on failure, the in-flight flags, and the PII-safe `view.opened` +
 * refresh diagnostics. Mirrors the web component's hook behaviour
 * (web/src/features/vehicles/components/VehiclePhotoUpload.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclePhotoUploadViewModelTest {
    private val vehicleId = 7L

    private fun meta(hasPhoto: Boolean): VehiclePhotoMeta = VehiclePhotoMeta(hasPhoto = hasPhoto, uploadedAt = "2026-06-01T00:00:00Z")

    private fun pickedPhoto(
        name: String = "car.jpg",
        mime: String? = "image/jpeg",
        bytes: ByteArray = byteArrayOf(1, 2, 3, 4),
        read: suspend () -> ByteArray = { bytes },
    ): PickedPhoto = PickedPhoto(name = name, mimeType = mime, sizeBytes = bytes.size.toLong(), readBytes = read)

    // ── photo-state matrix ─────────────────────────────────────────────────────────────

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.photoState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.photoState.value.phase)
        }

    @Test
    fun contentWhenPhotoPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(meta(hasPhoto = true), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.photoState.collect {} }
            advanceUntilIdle()

            val state = vm.photoState.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.hasUploadedPhoto())
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun absentPhotoStillResolvesToContentNeverEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(meta(hasPhoto = false), 100L, false))))
            backgroundScope.launch { vm.photoState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.photoState.value.phase)
            assertFalse(vm.photoState.value.hasUploadedPhoto())
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.photoState.collect {} }
            advanceUntilIdle()

            val state = vm.photoState.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.canRetry)
            assertFalse(state.hasData)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Error(meta(hasPhoto = true), 100L, true, ApiError.Timeout())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.photoState.collect {} }
            advanceUntilIdle()

            val state = vm.photoState.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    // ── upload ─────────────────────────────────────────────────────────────────────────

    @Test
    fun uploadForwardsBytesNameMimeAndRaisesUploadedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(meta(hasPhoto = false), 1L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)
            val bytes = byteArrayOf(9, 8, 7)

            vm.upload(pickedPhoto(name = "tesla.png", mime = "image/png", bytes = bytes))
            advanceUntilIdle()

            assertEquals(1, src.uploadCount)
            assertEquals("7", src.lastVehicleId)
            assertEquals("tesla.png", src.lastFileName)
            assertEquals("image/png", src.lastMime)
            assertArrayEquals(bytes, src.lastBytes)
            assertEquals(listOf<PhotoToast>(PhotoToast.Uploaded), received)
            assertFalse(vm.actions.value.uploading)
        }

    @Test
    fun uploadFailureSurfacesBackendReason() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(meta(hasPhoto = false), 1L, false)))
            src.uploadResult = Result.failure(IllegalArgumentException("Photo exceeds 8 MB limit."))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.upload(pickedPhoto())
            advanceUntilIdle()

            assertEquals(listOf<PhotoToast>(PhotoToast.UploadFailed("Photo exceeds 8 MB limit.")), received)
            assertFalse(vm.actions.value.uploading)
        }

    @Test
    fun uploadFailureWithBlankReasonFallsBackToGeneric() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(meta(hasPhoto = false), 1L, false)))
            src.uploadResult = Result.failure(RuntimeException("   "))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.upload(pickedPhoto())
            advanceUntilIdle()

            assertEquals(listOf<PhotoToast>(PhotoToast.UploadFailed(null)), received)
        }

    @Test
    fun uploadWhereByteReadFailsRaisesGenericFailureAndSkipsNetwork() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(meta(hasPhoto = false), 1L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.upload(pickedPhoto(read = { throw IOException("denied") }))
            advanceUntilIdle()

            assertEquals(0, src.uploadCount)
            assertEquals(listOf<PhotoToast>(PhotoToast.UploadFailed(null)), received)
            assertFalse(vm.actions.value.uploading)
        }

    // ── remove ─────────────────────────────────────────────────────────────────────────

    @Test
    fun removeRaisesRemovedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(meta(hasPhoto = true), 1L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.remove()
            advanceUntilIdle()

            assertEquals(1, src.deleteCount)
            assertEquals("7", src.lastVehicleId)
            assertEquals(listOf<PhotoToast>(PhotoToast.Removed), received)
            assertFalse(vm.actions.value.removing)
        }

    @Test
    fun removeFailureSurfacesReason() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(meta(hasPhoto = true), 1L, false)))
            src.deleteResult = Result.failure(ApiError.Http(status = 500, body = "boom"))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.remove()
            advanceUntilIdle()

            assertEquals(1, received.size)
            assertTrue(received.single() is PhotoToast.RemoveFailed)
            assertFalse(vm.actions.value.removing)
        }

    // ── retry + diagnostics ──────────────────────────────────────────────────────────

    @Test
    fun retryRefreshesFeedAndLogsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = FakeSource(emptyList())
            val vm = viewModel(src, logger)

            vm.retry()

            assertEquals(1, src.refreshCount)
            assertTrue(logger.events.any { it.first == "vehiclePhotoUpload.refresh" })
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "VehiclePhotoUpload"), opened.single().second)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────────

    private fun TestScope.collectToasts(vm: VehiclePhotoUploadViewModel): List<PhotoToast> {
        val received = mutableListOf<PhotoToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    private fun TestScope.viewModel(
        source: VehiclePhotoUploadSource,
        logger: Logger = NoopLogger,
    ): VehiclePhotoUploadViewModel = VehiclePhotoUploadViewModel(source, vehicleId, logger, backgroundScope)

    private class FakeSource(
        private val emissions: List<Resource<VehiclePhotoMeta>>,
    ) : VehiclePhotoUploadSource {
        var uploadResult: Result<VehiclePhotoMeta> = Result.success(VehiclePhotoMeta(hasPhoto = true, uploadedAt = "2026-06-01T00:00:00Z"))
        var deleteResult: Result<Unit> = Result.success(Unit)
        var uploadCount = 0
            private set
        var deleteCount = 0
            private set
        var refreshCount = 0
            private set
        var lastVehicleId: String? = null
            private set
        var lastFileName: String? = null
            private set
        var lastMime: String? = null
            private set
        var lastBytes: ByteArray? = null
            private set

        override fun vehiclePhoto(vehicleId: String): Flow<Resource<VehiclePhotoMeta>> = flow { emissions.forEach { emit(it) } }

        override fun refreshPhoto(vehicleId: String) {
            refreshCount++
            lastVehicleId = vehicleId
        }

        override suspend fun uploadVehiclePhoto(
            vehicleId: String,
            bytes: ByteArray,
            fileName: String,
            mimeType: String?,
        ): Result<VehiclePhotoMeta> {
            uploadCount++
            lastVehicleId = vehicleId
            lastBytes = bytes
            lastFileName = fileName
            lastMime = mimeType
            return uploadResult
        }

        override suspend fun deleteVehiclePhoto(vehicleId: String): Result<Unit> {
            deleteCount++
            lastVehicleId = vehicleId
            return deleteResult
        }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
