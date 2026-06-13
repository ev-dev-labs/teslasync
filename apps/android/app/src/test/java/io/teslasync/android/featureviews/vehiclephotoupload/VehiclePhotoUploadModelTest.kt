package io.teslasync.android.featureviews.vehiclephotoupload

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VEHICLE_PHOTO_MAX_BYTES
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives the pure data adapter + diagnostics behind [VehiclePhotoUpload] off-device — the `Resource → UiState`
 * projection ([toPhotoUiState]) across the cache-then-network matrix (loading / cached-refreshing / content /
 * empty-as-content / hard error / stale-offline), the `has_photo` reader, the shared photo-size cap, and the
 * PII-safe `view.opened` diagnostic. Mirrors the web component's hook behaviour
 * (web/src/features/vehicles/components/VehiclePhotoUpload.tsx + web/src/api/hooks/useVehiclePhoto.ts).
 */
class VehiclePhotoUploadModelTest {
    private fun meta(hasPhoto: Boolean): VehiclePhotoMeta = VehiclePhotoMeta(hasPhoto = hasPhoto, uploadedAt = "2026-06-01T00:00:00Z")

    // ── Resource → UiState matrix ──────────────────────────────────────────────────────

    @Test
    fun loadingWithNoCacheMapsToLoading() {
        val state = Resource.Loading<VehiclePhotoMeta>(cached = null, fetchedAt = null, stale = false).toPhotoUiState()
        assertEquals(UiPhase.Loading, state.phase)
        assertFalse(state.hasData)
    }

    @Test
    fun successWithPhotoMapsToContent() {
        val state = Resource.Success(meta(hasPhoto = true), fetchedAt = 100L, stale = false).toPhotoUiState()
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.hasUploadedPhoto())
        assertEquals(100L, state.fetchedAt)
    }

    @Test
    fun absentPhotoStillResolvesToContentNeverEmpty() {
        // Web parity: `has_photo:false` is an HTTP 200, so the drop-zone IS the friendly content (no empty branch).
        val state = Resource.Success(meta(hasPhoto = false), fetchedAt = 100L, stale = false).toPhotoUiState()
        assertEquals(UiPhase.Content, state.phase)
        assertFalse(state.hasUploadedPhoto())
    }

    @Test
    fun loadingWithCacheKeepsContentAndFlagsRefreshing() {
        val state = Resource.Loading(cached = meta(hasPhoto = true), fetchedAt = 100L, stale = false).toPhotoUiState()
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
        assertTrue(state.hasUploadedPhoto())
    }

    @Test
    fun errorWithNoCacheMapsToErrorWithRetry() {
        val error = ApiError.Network()
        val state = Resource.Error<VehiclePhotoMeta>(cached = null, fetchedAt = null, stale = false, error = error).toPhotoUiState()
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.canRetry)
        assertFalse(state.hasData)
    }

    @Test
    fun errorWithCacheKeepsContentStaleOfflineWithRetry() {
        val state =
            Resource.Error(cached = meta(hasPhoto = true), fetchedAt = 100L, stale = true, error = ApiError.Timeout()).toPhotoUiState()
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertTrue(state.canRetry)
        assertTrue(state.hasUploadedPhoto())
    }

    // ── has_photo reader ───────────────────────────────────────────────────────────────

    @Test
    fun hasUploadedPhotoIsFalseWhenNoDataOrNoPhoto() {
        assertFalse(Resource.Loading<VehiclePhotoMeta>(null, null, false).toPhotoUiState().hasUploadedPhoto())
        assertFalse(Resource.Success(meta(hasPhoto = false), 1L, false).toPhotoUiState().hasUploadedPhoto())
        assertTrue(Resource.Success(meta(hasPhoto = true), 1L, false).toPhotoUiState().hasUploadedPhoto())
    }

    // ── size cap ───────────────────────────────────────────────────────────────────────

    @Test
    fun photoMaxMegabytesMatchesSharedCap() {
        assertEquals(VEHICLE_PHOTO_MAX_BYTES / (1024L * 1024L), photoMaxMegabytes())
        assertEquals(8L, photoMaxMegabytes())
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugWithNoPii() {
        val logger = RecordingLogger()
        recordVehiclePhotoUploadOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "VehiclePhotoUpload"), opened.single().second)
    }

    @Test
    fun noopLoggerNeverThrows() {
        // The production logger no-ops until consent; recording must be side-effect-safe.
        recordVehiclePhotoUploadOpened(NoopLogger)
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
