// The data + platform ports the [VehiclePhotoUploadViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web component's hook composition (web/src/api/hooks/useVehiclePhoto.ts →
// web/src/features/vehicles/components/VehiclePhotoUpload.tsx). The view never performs HTTP or file IO itself;
// a shared adapter (the S8 `VehiclePhotoStore`) drives the data seam, and the host wires the platform IO ports
// ([PickedPhoto] reader, [VehiclePhotoImageLoader]). All are fakeable so the view-model is driven entirely
// off-device in tests.
//
// Cache-then-network freshness is preserved end to end (ADR-013): the photo-state emission's cached/stale/error
// flags flow through [vehiclePhoto] unchanged so the view-model renders the full state matrix. The two mutations
// are the web `useUploadVehiclePhoto` / `useDeleteVehiclePhoto` non-throwing `Result`s; the shared store already
// runs the client-side size/MIME validation ([io.teslasync.shared.core.data.repo.validateVehiclePhotoUpload])
// and the per-vehicle cache write-through + refresh on success, so none of that is re-implemented here.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/VehiclePhotoUpload) cannot form a valid Kotlin package and the file
// hosts the seam plus its store binding and the IO ports, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.vehiclephotoupload

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoStore
import kotlinx.coroutines.flow.Flow

/**
 * The single data seam the [VehiclePhotoUploadViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store or the network. [vehiclePhoto] is the cache-then-network read the web
 * `useVehiclePhoto` hook serves; [refreshPhoto] is the web `invalidateQueries(vehiclePhotoKeys.detail(id))`
 * analogue backing the retry affordance; [uploadVehiclePhoto] / [deleteVehiclePhoto] mirror the web
 * `useUploadVehiclePhoto` / `useDeleteVehiclePhoto` non-throwing mutations. No HTTP touches the view.
 */
interface VehiclePhotoUploadSource {
    /** Stream the cache-then-network photo metadata for [vehicleId] (web `useVehiclePhoto`, `GET /vehicles/{id}/photo`). */
    fun vehiclePhoto(vehicleId: String): Flow<Resource<VehiclePhotoMeta>>

    /**
     * Re-fetch the photo feed for [vehicleId] — the holder-side analogue of invalidating
     * `vehiclePhotoKeys.detail(id)` (web `refetch`). A vehicle nobody is observing is a no-op.
     */
    fun refreshPhoto(vehicleId: String)

    /**
     * Upload [bytes] as the vehicle's new photo (web `useUploadVehiclePhoto`). The shared store runs the
     * client-side size/MIME validation first (a rejected file short-circuits to a `Result.failure` carrying the
     * byte-identical web message and never hits the network), then writes the fresh meta through the cache and
     * refreshes the feed on success. [fileName] names the multipart part; [mimeType] sets its `Content-Type`.
     */
    suspend fun uploadVehiclePhoto(
        vehicleId: String,
        bytes: ByteArray,
        fileName: String,
        mimeType: String?,
    ): Result<VehiclePhotoMeta>

    /**
     * Remove the vehicle's photo (web `useDeleteVehiclePhoto`). Idempotent on the backend; on success the shared
     * store writes a `has_photo:false` meta through the cache and refreshes the feed. Reduced to [Unit] because
     * the surface only needs success/failure, not the echoed document.
     */
    suspend fun deleteVehiclePhoto(vehicleId: String): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [VehiclePhotoStore] — the memoized, multi-observer per-vehicle photo
 * feed every photo surface shares app-wide (web `useVehiclePhoto`). The mutations route through the store so its
 * write-through + per-vehicle refresh + cross-domain `onVehicleChanged` hook fire exactly as the matching web
 * hooks invalidate `vehiclePhotoKeys.detail(id)` + `vehicleKeys.detail(id)`. No HTTP touches the view — the
 * store (S7/S8) owns it.
 */
fun vehiclePhotoUploadSource(store: VehiclePhotoStore): VehiclePhotoUploadSource =
    object : VehiclePhotoUploadSource {
        override fun vehiclePhoto(vehicleId: String): Flow<Resource<VehiclePhotoMeta>> = store.vehiclePhoto(vehicleId)

        override fun refreshPhoto(vehicleId: String) = store.refreshPhotoFeed(vehicleId)

        override suspend fun uploadVehiclePhoto(
            vehicleId: String,
            bytes: ByteArray,
            fileName: String,
            mimeType: String?,
        ): Result<VehiclePhotoMeta> = store.uploadVehiclePhoto(vehicleId, bytes, fileName, mimeType)

        override suspend fun deleteVehiclePhoto(vehicleId: String): Result<Unit> = store.deleteVehiclePhoto(vehicleId)
    }

/**
 * A photo the user picked for upload — the native analogue of the web `File` the change/drop handlers receive.
 * [name] names the multipart part; [mimeType] is the declared image type (`null` when the platform omits it for
 * an unusual extension — the shared store still does the authoritative check); [sizeBytes] is the declared size
 * the validation guard reads BEFORE the bytes are streamed; [readBytes] reads the full image bytes (web
 * `File`→ArrayBuffer) and throws on an IO failure, which the view-model maps to an upload-failed toast. The host
 * backs this with a `ContentResolver`; tests pass a fake with in-memory bytes.
 */
class PickedPhoto(
    val name: String,
    val mimeType: String?,
    val sizeBytes: Long,
    val readBytes: suspend () -> ByteArray,
)

/**
 * The optional read-back port the surface uses to render the vehicle's CURRENT (already-uploaded) photo — the
 * native analogue of the web `<img src={vehiclePhotoUrl(...)}>` preview. The web fetches the rendered image over
 * the authenticated session; on Android the host wires this seam to GET the bytes for
 * `io.teslasync.shared.core.data.repo.vehiclePhotoUrl(...)` through the shared `ApiHttpClient` (auth +
 * resilience reused), and previews/tests pass [None]. A `null` return is the honest "couldn't load / not wired"
 * branch — the surface then shows its empty drop-zone prompt (never a blank box) while the Replace / Remove
 * controls still convey that a photo is on file.
 */
fun interface VehiclePhotoImageLoader {
    /** Fetch the rendered medium-size photo bytes for [vehicleId], or `null` when unavailable. */
    suspend fun load(vehicleId: Long): ByteArray?

    companion object {
        /** The no-op loader used by previews/tests and any host that has not wired remote photo rendering. */
        val None: VehiclePhotoImageLoader = VehiclePhotoImageLoader { null }
    }
}
