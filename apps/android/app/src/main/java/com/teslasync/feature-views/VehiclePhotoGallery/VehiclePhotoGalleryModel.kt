// Pure, framework-free model + projection for the VehiclePhotoGallery feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/vehicles/components/VehiclePhotoGallery.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// The web component is a display-only wrapper around the shared Lightbox: it receives `photos`
// (`LightboxImage[]` of `{ src, alt, caption }`) and a `vehicleName`, renders a square thumbnail grid, and
// opens the lightbox at the tapped index. Its only derivations are the empty guard (`photos.length === 0`),
// the per-thumbnail accessible label (`Open photo {{i + 1}} of {{photos.length}}`), and the stable list key
// (`${photo.src}-${i}`). This file owns exactly those derivations as a vendor-neutral projection: each
// [VehiclePhoto] becomes a [VehiclePhotoSlide] carrying its preserved [VehiclePhotoSlide.src]/[alt]/[caption],
// its 1-based [position] and the [total] (the two interpolation args), and its [key], plus the
// [VehiclePhotoGalleryProjectionResult.isEmpty] flag. Localized labels, colors and the lightbox binding are
// resolved at the Compose boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehiclePhotoGallery — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclephotogallery

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object VehiclePhotoGalleryRegistration {
    /** Stable surface id. */
    const val ID: String = "vehicle-photo-gallery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehiclePhotoGallery"
}

/**
 * The native mirror of the slice of a web `LightboxImage` this gallery reads: the image [src] (an opaque
 * reference the host's image loader resolves — the view never decodes bytes, matching the shared Lightbox's
 * decoupled `imageContent` contract), the accessible [alt] text (web `LightboxImage.alt`), and an optional
 * [caption] shown beneath the image in the lightbox (web `LightboxImage.caption`). The host's shared P1/S8
 * state-holder adapts the fleet image records (`image_url`, `angle`) into these; the view performs no HTTP.
 */
data class VehiclePhoto(
    val src: String,
    val alt: String,
    val caption: String? = null,
)

/**
 * A fully projected, render-ready gallery item — the native analogue of the data the web component reads per
 * `photos.map((photo, i) => …)`. Pure data (no Compose types): [key] is the stable list key (web
 * `${photo.src}-${i}`), [src] is passed to the host image slot, [position] is the 1-based index and [total]
 * the count (the two `Open photo {{index}} of {{total}}` interpolation args), [alt] becomes the lightbox
 * content description, and [caption] the lightbox caption.
 */
data class VehiclePhotoSlide(
    val key: String,
    val src: String,
    val position: Int,
    val total: Int,
    val alt: String,
    val caption: String?,
)

/**
 * The fully projected inputs the composable renders — the native analogue of the data the web component reads
 * from `photos`. [slides] preserves the received order (the web map order); [isEmpty] drives the empty branch
 * (web `photos.length === 0`).
 */
data class VehiclePhotoGalleryProjectionResult(
    val slides: List<VehiclePhotoSlide>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-photo derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object VehiclePhotoGalleryProjection {
    /**
     * Projects [photos] into render-ready [VehiclePhotoSlide]s, preserving the received order. Each photo
     * contributes one slide with its stable [VehiclePhotoSlide.key] (web `${photo.src}-${i}`), its 1-based
     * [VehiclePhotoSlide.position] and the shared [VehiclePhotoSlide.total];
     * [VehiclePhotoGalleryProjectionResult.isEmpty] is `true` when there are no photos (web
     * `photos.length === 0`).
     */
    fun project(photos: List<VehiclePhoto>): VehiclePhotoGalleryProjectionResult {
        val total = photos.size
        val slides =
            photos.mapIndexed { index, photo ->
                VehiclePhotoSlide(
                    key = "${photo.src}-$index",
                    src = photo.src,
                    position = index + 1,
                    total = total,
                    alt = photo.alt,
                    caption = photo.caption,
                )
            }
        return VehiclePhotoGalleryProjectionResult(slides = slides, isEmpty = slides.isEmpty())
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [VehiclePhotoGalleryRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordVehiclePhotoGalleryOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to VehiclePhotoGalleryRegistration.SLUG))
}
