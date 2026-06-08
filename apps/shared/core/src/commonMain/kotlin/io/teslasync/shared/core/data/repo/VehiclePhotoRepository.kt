package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoSize
import kotlinx.coroutines.flow.Flow
import kotlin.time.Instant

/**
 * The S7 data port for the vehicle-photo surface — the cross-platform analogue of the web
 * `useVehiclePhoto` hook domain (web/src/api/hooks/useVehiclePhoto.ts). Every native photo screen
 * (the hero card + the upload control on Android/Apple via KMP, Windows via the C# port) reaches the
 * backend exclusively through this interface, so a single fake stands in for the whole domain in the
 * S8 state-holder tests.
 *
 * One read and two mutations, mirroring the three web primitives:
 *  - [vehiclePhoto] — `GET /vehicles/{vehicleId}/photo`, the metadata query (web `useVehiclePhoto`).
 *    Streams a cache-then-network [Resource] (ADR-013) cached under [vehiclePhotoCacheKey]. The
 *    backend always answers `200` (`has_photo:false` is the absent signal, never a `404`), so the
 *    absent-photo case is a normal [Resource.Success], not an error.
 *  - [uploadVehiclePhoto] — `POST /vehicles/{vehicleId}/photo`, the multipart upload (web
 *    `useUploadVehiclePhoto`). Returns the fresh [VehiclePhotoMeta]; on success the new meta is
 *    written through the cache (the web `queryClient.setQueryData(detail, data)`).
 *  - [deleteVehiclePhoto] — `DELETE /vehicles/{vehicleId}/photo`, the idempotent remove (web
 *    `useDeleteVehiclePhoto`). On success a `has_photo:false` meta is written through (the web
 *    `setQueryData(detail, { has_photo:false })`).
 *
 * The web read carries `staleTime: 60_000`, which the [io.teslasync.shared.core.cache.CacheDomain]
 * default TTL ([VEHICLE_PHOTO_TTL_MILLIS]) matches verbatim. Both mutations write through but never
 * evict: the S8 store re-collects the feed so the optimistic value shows instantly and the
 * cache-then-network refetch then confirms it — the exact `setQueryData` + `invalidateQueries`
 * sequence the web hooks run. The web's *second* invalidation (`vehicleKeys.detail(id)`) is a
 * cross-domain concern handled by the S8 store's injected vehicle-refresh hook, not here.
 *
 * Photo metadata (a bool, an ISO stamp, rendered-path strings) is not unit-bearing, so it
 * round-trips verbatim with no SI conversion.
 */
public interface VehiclePhotoRepository {
    /**
     * `GET /vehicles/{vehicleId}/photo` — the photo metadata for [vehicleId] (web
     * `useVehiclePhoto`). The cache key is built by [vehiclePhotoCacheKey], mirroring the web
     * `vehiclePhotoKeys.detail` tuple. Always resolves to a [VehiclePhotoMeta] (the absent case is
     * `has_photo:false`, never an error).
     */
    public fun vehiclePhoto(vehicleId: String): Flow<Resource<VehiclePhotoMeta>>

    /**
     * `POST /vehicles/{vehicleId}/photo` — multipart upload of [bytes] under the form field
     * [VEHICLE_PHOTO_FORM_FIELD] (web `useUploadVehiclePhoto`). [fileName] names the part and
     * [mimeType] sets its `Content-Type`. Returns the freshly stored [VehiclePhotoMeta]; on success
     * that meta is written through this vehicle's [vehiclePhotoCacheKey] (the web `setQueryData`), so
     * a subsequent read reflects the new photo without waiting on the network. Client-side size/mime
     * validation ([validateVehiclePhotoUpload]) is the caller's (the S8 store's) responsibility, as
     * it is in the web `mutationFn`.
     */
    public suspend fun uploadVehiclePhoto(
        vehicleId: String,
        bytes: ByteArray,
        fileName: String,
        mimeType: String?,
    ): Result<VehiclePhotoMeta>

    /**
     * `DELETE /vehicles/{vehicleId}/photo` — removes the vehicle's photo (web
     * `useDeleteVehiclePhoto`). Idempotent on the backend (`204` even with no row). On success a
     * `has_photo:false` [VehiclePhotoMeta] is written through this vehicle's [vehiclePhotoCacheKey]
     * (the web `setQueryData(detail, { has_photo:false })`).
     */
    public suspend fun deleteVehiclePhoto(vehicleId: String): Result<Unit>
}

/**
 * Builds the stable cache/feed key for a vehicle's photo metadata, mirroring the web
 * `vehiclePhotoKeys.detail` tuple `['vehicle-photos', id]`. Prefixed with `vehicle-photos:` so it
 * partitions per vehicle within the one photo cache domain. Locked by golden vectors shared with the
 * C# port.
 */
public fun vehiclePhotoCacheKey(vehicleId: String): String = "vehicle-photos:$vehicleId"

/** Multipart form-field name the backend expects on the upload — the web `VEHICLE_PHOTO_FORM_FIELD`. */
public const val VEHICLE_PHOTO_FORM_FIELD: String = "photo"

/** Client-side hard cap mirroring the backend `MaxUploadBytes` and the web `VEHICLE_PHOTO_MAX_BYTES` (8 MiB). */
public const val VEHICLE_PHOTO_MAX_BYTES: Long = 8L * 1024 * 1024

/**
 * Allowed upload MIME types — matches the backend `AllowedPhotoMimeTypes` and the web
 * `VEHICLE_PHOTO_ALLOWED_MIME`. WebP is intentionally absent (the server's pure-stdlib decode path
 * has no WebP decoder).
 */
public val VEHICLE_PHOTO_ALLOWED_MIME: Set<String> =
    setOf(
        "image/jpeg",
        "image/jpg",
        "image/png",
    )

/**
 * Per-entity staleness threshold for the photo read — the web `useVehiclePhoto` `staleTime`
 * (`60_000`). Matches the [io.teslasync.shared.core.cache.CacheDomain.VehiclePhoto] default, so it is
 * the domain window rather than a per-read override.
 */
public const val VEHICLE_PHOTO_TTL_MILLIS: Long = 60_000L

/** Why a candidate upload failed client-side — the cross-platform port of the web `VehiclePhotoValidationError.reason`. */
public enum class VehiclePhotoValidationReason {
    EMPTY,
    SIZE,
    MIME,
}

/**
 * A client-side upload rejection — the cross-platform port of the web `VehiclePhotoValidationError`
 * (web `validateVehiclePhotoFile`). Surfaced so the caller can reject a doomed upload BEFORE firing
 * the request, exactly as the web component does.
 *
 * @property reason the machine-readable category of the failure.
 * @property message a human-readable explanation, byte-identical to the web string.
 */
public data class VehiclePhotoValidationError(
    val reason: VehiclePhotoValidationReason,
    val message: String,
)

/**
 * Validates a candidate upload against the size + MIME constraints — the cross-platform port of the
 * web `validateVehiclePhotoFile`, returning `null` when the file is acceptable. Mirrors the web
 * order exactly: empty (no/zero bytes) first, then the [VEHICLE_PHOTO_MAX_BYTES] cap, then the
 * [VEHICLE_PHOTO_ALLOWED_MIME] check — and, like the web, a `null`/blank [mimeType] is allowed
 * through (some platforms omit the type for unusual extensions; the server does the authoritative
 * check). The messages are byte-identical to the web strings so toasts read the same on every
 * platform. Locked by golden vectors shared with the C# port.
 *
 * @param byteSize the candidate file's size in bytes.
 * @param mimeType the candidate file's declared MIME type, or `null` when unknown.
 */
public fun validateVehiclePhotoUpload(
    byteSize: Long,
    mimeType: String?,
): VehiclePhotoValidationError? {
    if (byteSize <= 0L) {
        return VehiclePhotoValidationError(VehiclePhotoValidationReason.EMPTY, "Selected file is empty.")
    }
    if (byteSize > VEHICLE_PHOTO_MAX_BYTES) {
        val limitMb = VEHICLE_PHOTO_MAX_BYTES / (1024 * 1024)
        return VehiclePhotoValidationError(
            VehiclePhotoValidationReason.SIZE,
            "Photo exceeds $limitMb MB limit.",
        )
    }
    if (!mimeType.isNullOrBlank() && !VEHICLE_PHOTO_ALLOWED_MIME.contains(mimeType.lowercase())) {
        return VehiclePhotoValidationError(
            VehiclePhotoValidationReason.MIME,
            "Unsupported image type: $mimeType",
        )
    }
    return null
}

/**
 * Builds the URL for a rendered photo [size] — the cross-platform port of the web `vehiclePhotoUrl`.
 * Returns `null` when [meta] is `null` or reports no photo, so a caller can use the falsy return as
 * the "fall back to the stock render" branch, exactly as the web hero card does.
 *
 * The path is deterministic per upload (`{baseUrl}/api/v1/vehicles/{vehicleId}/photo/{size}`), so the
 * builder threads [VehiclePhotoMeta.uploadedAt] through as a `?v=` cache-buster (the epoch-millisecond
 * parse of the ISO stamp) — a re-upload changes the bytes but not the path, and `?v=` is the only
 * signal a client cache has that the image changed. A `null` or unparseable stamp yields the bare
 * path (mirroring the web `Number.isNaN` fall-through). [baseUrl] is the same host the
 * [io.teslasync.shared.core.net.ApiHttpClient] is configured with; the `/api/v1` segment is added
 * here exactly once. Locked by golden vectors shared with the C# port.
 */
public fun vehiclePhotoUrl(
    baseUrl: String,
    vehicleId: String,
    size: VehiclePhotoSize,
    meta: VehiclePhotoMeta?,
): String? {
    if (meta == null || !meta.hasPhoto) return null
    val base = "${baseUrl.trimEnd('/')}/api/v1/vehicles/$vehicleId/photo/${size.wire}"
    val stamp = meta.uploadedAt ?: return base
    val millis =
        try {
            Instant.parse(stamp).toEpochMilliseconds()
        } catch (e: IllegalArgumentException) {
            // Unparseable stamp ⇒ the web `Number.isNaN(ts)` fall-through: serve the bare path.
            return base
        }
    return "$base?v=$millis"
}
