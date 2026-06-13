// Pure, framework-free model + projection backing the Compose [VehiclePhotoUpload] feature view — the native
// analogue of every value the web component derives before returning JSX
// (web/src/features/vehicles/components/VehiclePhotoUpload.tsx). No Compose, no Android UI, no HTTP, no file IO:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// VehiclePhotoUpload is the per-vehicle photo control. The web component reads `/vehicles/{id}/photo` via
// `useVehiclePhoto()` (drives the "remove" affordance), uploads via `useUploadVehiclePhoto()`, and deletes via
// `useDeleteVehiclePhoto()`, raising a `useToast()` toast on every outcome. This file owns the parts the web
// render derives from that payload, with nothing to do with Compose:
//   • the cache-then-network read → [UiState] projection (web's `meta` query state);
//   • the typed toast set the two mutations raise (web `toast.success` / `toast.error`);
//   • the photo-size cap rendered in the constraints line (web `(MAX_BYTES / 1MiB).toFixed(0)`);
//   • the PII-safe `view.opened` diagnostic the surface emits (P1/S11).
//
// Binding (P1/S8): this surface performs NO HTTP. The owning host wires the shared
// `VehiclePhotoStore` (the cross-platform port of the three `useVehiclePhoto` primitives, in :core) into the
// [VehiclePhotoUploadViewModel] through [VehiclePhotoUploadSource]. The validation, cache key, URL builder, and
// per-vehicle invalidation all live in the shared store/repository, so no English literal or endpoint string is
// re-implemented here.
//
// Web parity — there is NO empty surface: the backend always answers 200 (`has_photo:false` is the absent
// signal, never a 404), so the absent-photo case is the friendly drop-zone (content), exactly like the web's
// simple present/absent ternary. The emptiness predicate folded into [toPhotoUiState] is therefore `false`, so a
// resolved read always renders content — loading (no cache), hard error (no cache), and the stale/offline cached
// view are the other surfaces, mirroring the sibling feature-view surfaces' lifecycle contract.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehiclePhotoUpload — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclephotoupload

import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VEHICLE_PHOTO_MAX_BYTES
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object VehiclePhotoUploadRegistration {
    /** Stable surface id. */
    const val ID: String = "vehicle-photo-upload"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle payload. */
    const val SLUG: String = "VehiclePhotoUpload"
}

/**
 * The typed, localized-at-the-boundary toasts the surface raises for its two mutations — the native analogue of
 * the web component's `useToast` calls. The web shows the backend's `err.message` when present and falls back to
 * a generic key otherwise (`toast.error(message || t('…Failed'))`); the [UploadFailed] / [RemoveFailed] variants
 * therefore carry the optional backend [message] so the Compose boundary reproduces that exact "specific reason,
 * else generic" choice without ever holding an English literal in code.
 */
sealed interface PhotoToast {
    /** A photo upload succeeded — web `toast.success(t('vehicles.photos.uploadSuccess'))`. */
    data object Uploaded : PhotoToast

    /** A photo removal succeeded — web `toast.success(t('vehicles.photos.deleteSuccess'))`. */
    data object Removed : PhotoToast

    /**
     * A photo upload failed — web `toast.error(message || t('vehicles.photos.uploadFailed'))`. [message] is the
     * backend/validation reason when one was supplied (already human-readable, byte-identical to the web
     * strings), or `null` to fall back to the generic catalog key.
     */
    data class UploadFailed(
        val message: String?,
    ) : PhotoToast

    /**
     * A photo removal failed — web `toast.error(message || t('vehicles.photos.deleteFailed'))`. [message] is the
     * backend reason when one was supplied, or `null` to fall back to the generic catalog key.
     */
    data class RemoveFailed(
        val message: String?,
    ) : PhotoToast
}

/**
 * Projects the shared `VehiclePhotoStore.vehiclePhoto()` feed's cache-then-network [Resource] (P1/S8) onto the
 * Android [UiState] this surface binds — the data adapter the host wires the surface up with
 * (`source.vehiclePhoto(id).map { it.toPhotoUiState() }`) and the unit test drives directly. The emptiness
 * predicate is `false` (web parity — the absent-photo read is the friendly drop-zone content, never an empty
 * box), so a resolved read always renders content; loading (no cache), hard error (no cache), and the
 * stale/offline "last known" view are surfaced by the shared [toUiState] mapping unchanged.
 */
fun Resource<VehiclePhotoMeta>.toPhotoUiState(): UiState<VehiclePhotoMeta> = toUiState { false }

/** Whether the resolved metadata reports an uploaded photo — web `Boolean(meta.data?.has_photo)`. */
fun UiState<VehiclePhotoMeta>.hasUploadedPhoto(): Boolean = data?.hasPhoto == true

/**
 * The whole-megabyte photo-size cap shown in the constraints line — web
 * `(VEHICLE_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0)`. Derived from the single shared constant so the cap can
 * never drift from the backend / web / other native ports.
 */
fun photoMaxMegabytes(): Long = VEHICLE_PHOTO_MAX_BYTES / (1024L * 1024L)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [VehiclePhotoUploadRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the screen's first-composition effect. Carries no vehicle id, filename, or photo bytes, so a diagnostics line
 * can never leak which vehicle's photo was viewed or changed.
 */
fun recordVehiclePhotoUploadOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to VehiclePhotoUploadRegistration.SLUG))
}

internal const val EVENT_VIEW_OPENED = "view.opened"
internal const val EVENT_REFRESH = "vehiclePhotoUpload.refresh"
internal const val FIELD_SURFACE = "surface"
