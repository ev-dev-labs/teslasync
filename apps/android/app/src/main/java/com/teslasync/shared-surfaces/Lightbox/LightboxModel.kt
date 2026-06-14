// Pure, framework-free model + projection for the Lightbox shared surface — the native analogue of the
// state the web immersive image viewer derives before returning its overlay JSX
// (web/src/components/ui/Lightbox.tsx). No Compose, no Android UI, no HTTP: every type here is exercised by
// the :android:testReleaseUnitTest gate so the composable stays a thin render layer.
//
// The web `Lightbox` is a controlled overlay handed a sequence of images (`images: LightboxImage[]`) plus
// `open` / `onClose` / `initialIndex`. Its only declared data sources are `useTranslation` (i18n) and
// `useId` (a generated aria id) — there is no remote feed. What the component OWNS, and what this model
// reproduces, is the immersive viewer's interaction state: the active [index], the [zoom] (1×–5× in 0.5×
// steps), the drag [pan] offset that is only honoured while zoomed, and whether the current image has
// [decoded] yet (the web decode skeleton). Every navigation / zoom / pan / decode mutation is a pure,
// side-effect-free transition on [LightboxViewerState] so the parity-critical maths is unit-tested
// off-device.
//
// The gallery the viewer renders is the surface's single (host-supplied) data source. Mirroring the
// StatusBar precedent, it is carried as a cache-then-network [io.teslasync.shared.core.data.repo.Resource]
// feed so the prompt's loading / content / empty / error / stale / offline state matrix folds out of the
// same honest contract every other surface uses — never a fabricated remote dependency the web component
// does not have. A resolved gallery with no slides is the structurally-empty branch (the web `images=[]`
// `return null`), surfaced as a friendly empty state rather than a blank box.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Lightbox — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.lightbox

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import kotlin.math.roundToInt

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the zoom envelope (web `LIGHTBOX_MIN_ZOOM` / `LIGHTBOX_MAX_ZOOM` /
 * `LIGHTBOX_ZOOM_STEP`) are pinned here so the native and web shells stay in lockstep.
 */
object LightboxRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Lightbox"

    /** Minimum zoom factor — 1× (fit). Web `LIGHTBOX_MIN_ZOOM`. */
    const val MIN_ZOOM: Float = 1f

    /** Maximum zoom factor — 5×. Web `LIGHTBOX_MAX_ZOOM`. */
    const val MAX_ZOOM: Float = 5f

    /** Zoom increment per +/- step — 0.5×. Web `LIGHTBOX_ZOOM_STEP`. */
    const val ZOOM_STEP: Float = 0.5f

    /** 1× expressed as a percentage, for the zoom-level readout (web `Math.round(zoom * 100)`). */
    const val FULL_PERCENT: Int = 100
}

/**
 * One image in the gallery — the native port of the web `LightboxImage`. [alt] is the accessible
 * description (an empty string is allowed for purely decorative images, but the field is always present so
 * callers make a deliberate choice, exactly like the web prop). [caption] is the optional line rendered
 * beneath the image.
 *
 * @property src the image URL (resolved by the host-supplied slide renderer; the view performs no I/O).
 * @property alt the accessible description; blank ⇒ decorative (skipped by TalkBack).
 * @property caption the optional caption rendered below the image.
 */
data class LightboxSlide(
    val src: String,
    val alt: String,
    val caption: String? = null,
)

/**
 * The gallery the viewer navigates — the surface's single data-source payload (the web `images` prop plus
 * `initialIndex`). An empty [slides] list is the structurally-empty branch (web `images.length === 0`).
 *
 * @property slides the ordered images to navigate.
 * @property initialIndex the image to show first; clamped by [safeInitialIndex] (web clamp).
 */
data class LightboxGallery(
    val slides: List<LightboxSlide>,
    val initialIndex: Int = 0,
) {
    /** The number of images (web `total = images.length`). */
    val total: Int get() = slides.size

    /**
     * The starting index clamped into range — the native port of the web
     * `Math.min(Math.max(initialIndex, 0), Math.max(total - 1, 0))`. An empty gallery clamps to 0.
     */
    val safeInitialIndex: Int get() = initialIndex.coerceIn(0, (total - 1).coerceAtLeast(0))
}

/**
 * The immersive viewer's interaction state — the native port of the web component's `index` / `zoom` /
 * `pan` / `decoded` `useState` values. Pure data; all transitions live in [LightboxProjection].
 *
 * @property index the active image index.
 * @property zoom the current zoom factor in `[MIN_ZOOM, MAX_ZOOM]`.
 * @property panX horizontal drag offset (only meaningful while zoomed).
 * @property panY vertical drag offset (only meaningful while zoomed).
 * @property decoded whether the active image has finished loading (web `decoded`; hides the skeleton).
 */
data class LightboxViewerState(
    val index: Int,
    val zoom: Float = LightboxRegistration.MIN_ZOOM,
    val panX: Float = 0f,
    val panY: Float = 0f,
    val decoded: Boolean = false,
) {
    /** True when zoomed past 1× — the image is then a draggable, pannable surface (web `isZoomed`). */
    val isZoomed: Boolean get() = zoom > LightboxRegistration.MIN_ZOOM

    /** True when a further zoom-in step is possible (web `canZoomIn = zoom < MAX`). */
    val canZoomIn: Boolean get() = zoom < LightboxRegistration.MAX_ZOOM

    /** True when a zoom-out step is possible (web `canZoomOut = zoom > MIN`). */
    val canZoomOut: Boolean get() = zoom > LightboxRegistration.MIN_ZOOM

    /**
     * True when the reset control should be enabled — zoomed OR panned. Native port of the web
     * `disabled={!isZoomed && pan.x === 0 && pan.y === 0}` (enabled = the negation).
     */
    val resetEnabled: Boolean get() = isZoomed || panX != 0f || panY != 0f

    /** The zoom factor as a rounded percentage for the readout (web `Math.round(zoom * 100)`). */
    val zoomPercent: Int get() = (zoom * LightboxRegistration.FULL_PERCENT).roundToInt()
}

/**
 * The freshness envelope the shell flags over its (host-supplied) gallery — folded from the bound feed's
 * [UiState] so a last-known gallery is never presented as live. [Live] shows no chip; [Stale] shows the
 * stale chip while a re-fetch runs over the cached gallery; [Offline] shows the offline chip when a fetch
 * failed but the cached gallery is still served.
 */
enum class LightboxFreshness { Live, Stale, Offline }

/**
 * Localized chrome labels the surface folds into its output. The static labels are built from
 * `stringResource` at the render boundary (tests pass a deterministic instance), keeping the projection a
 * pure, locale-stable object. [counter] and [zoomPercent] are templated catalog strings (web
 * `lightbox.counter` `{{current}} / {{total}}` and `lightbox.zoomPercent` `{{value}}%`), supplied as
 * formatter lambdas so the stateless view can render them without a `Context`.
 *
 * @property close the close affordance label (web `lightbox.close`).
 * @property previous the previous-image label (web `lightbox.previous`).
 * @property next the next-image label (web `lightbox.next`).
 * @property zoomOut the zoom-out label (web `lightbox.zoomOut`).
 * @property zoomIn the zoom-in label (web `lightbox.zoomIn`).
 * @property zoomReset the reset-zoom label (web `lightbox.zoomReset`).
 * @property loading the loading-chrome announcement (common catalog).
 * @property empty the empty-gallery message (common catalog).
 * @property error the load-failure message (error catalog).
 * @property stale the stale freshness chip label (mqtt catalog).
 * @property offline the offline freshness chip label (common catalog).
 * @property retry the retry affordance label (common catalog).
 * @property counter formats the `n / total` counter (web `lightbox.counter`).
 * @property zoomPercent formats the `nnn%` zoom readout (web `lightbox.zoomPercent`).
 */
data class LightboxStrings(
    val close: String,
    val previous: String,
    val next: String,
    val zoomOut: String,
    val zoomIn: String,
    val zoomReset: String,
    val loading: String,
    val empty: String,
    val error: String,
    val stale: String,
    val offline: String,
    val retry: String,
    val counter: (current: Int, total: Int) -> String,
    val zoomPercent: (value: Int) -> String,
) {
    /** True when every accessibility-critical interactive label is present (no blank aria copy ships). */
    val hasAccessibilityLabels: Boolean
        get() =
            close.isNotBlank() &&
                previous.isNotBlank() &&
                next.isNotBlank() &&
                zoomIn.isNotBlank() &&
                zoomOut.isNotBlank() &&
                zoomReset.isNotBlank()
}

/**
 * Pure projection + transition logic for the Lightbox surface — the native port of the web component's
 * navigation (`goPrev` / `goNext` / `goFirst` / `goLast`), zoom (`zoomIn` / `zoomOut` / `zoomReset`),
 * pan, decode, and the per-image reset effect. Every function returns a new [LightboxViewerState] (or a
 * derived value); nothing here touches Compose, Android, or coroutines, so the whole interaction contract
 * is unit-tested off-device.
 */
object LightboxProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /** The starting viewer state for [gallery] — clamped initial index, 1× zoom, no pan, not decoded. */
    fun initialViewerState(gallery: LightboxGallery): LightboxViewerState = LightboxViewerState(index = gallery.safeInitialIndex)

    /** The structurally-empty predicate for the gallery feed (web `images.length === 0`). */
    fun isEmpty(gallery: LightboxGallery): Boolean = gallery.slides.isEmpty()

    /** The image to render for [state], clamped into range; `null` only for an empty gallery. */
    fun currentSlide(
        gallery: LightboxGallery,
        state: LightboxViewerState,
    ): LightboxSlide? = gallery.slides.getOrNull(state.index.coerceIn(0, (gallery.total - 1).coerceAtLeast(0)))

    /** True at the first image — the prev control is then disabled (web `atFirst = index === 0`). */
    fun atFirst(state: LightboxViewerState): Boolean = state.index <= 0

    /** True at the last image — the next control is then disabled (web `atLast = index >= total - 1`). */
    fun atLast(
        state: LightboxViewerState,
        total: Int,
    ): Boolean = state.index >= total - 1

    /**
     * Navigates to [target], clamped into `[0, total - 1]`. A real index change resets zoom / pan /
     * decoded (web `useEffect([index])`); navigating to the current index is a no-op so an in-flight pan
     * is not discarded.
     */
    fun goTo(
        state: LightboxViewerState,
        target: Int,
        total: Int,
    ): LightboxViewerState {
        val clamped = target.coerceIn(0, (total - 1).coerceAtLeast(0))
        return if (clamped == state.index) state else LightboxViewerState(index = clamped)
    }

    /** Steps to the previous image (web `goPrev = max(0, i - 1)`). */
    fun goPrev(
        state: LightboxViewerState,
        total: Int,
    ): LightboxViewerState = goTo(state, state.index - 1, total)

    /** Steps to the next image (web `goNext = min(total - 1, i + 1)`). */
    fun goNext(
        state: LightboxViewerState,
        total: Int,
    ): LightboxViewerState = goTo(state, state.index + 1, total)

    /** Jumps to the first image (web `goFirst = 0`, the `Home` key). */
    fun goFirst(
        state: LightboxViewerState,
        total: Int,
    ): LightboxViewerState = goTo(state, 0, total)

    /** Jumps to the last image (web `goLast = max(0, total - 1)`, the `End` key). */
    fun goLast(
        state: LightboxViewerState,
        total: Int,
    ): LightboxViewerState = goTo(state, total - 1, total)

    /** Zooms in one step, capped at [LightboxRegistration.MAX_ZOOM] (web `zoomIn`). */
    fun zoomIn(state: LightboxViewerState): LightboxViewerState {
        val next = (state.zoom + LightboxRegistration.ZOOM_STEP).coerceAtMost(LightboxRegistration.MAX_ZOOM)
        return state.copy(zoom = next)
    }

    /**
     * Zooms out one step, floored at [LightboxRegistration.MIN_ZOOM]. Snapping back to 1× also clears the
     * pan so the image re-centres (web `zoomOut`: `if (next === MIN) setPan({ x: 0, y: 0 })`).
     */
    fun zoomOut(state: LightboxViewerState): LightboxViewerState {
        val next = (state.zoom - LightboxRegistration.ZOOM_STEP).coerceAtLeast(LightboxRegistration.MIN_ZOOM)
        return if (next <= LightboxRegistration.MIN_ZOOM) {
            state.copy(zoom = LightboxRegistration.MIN_ZOOM, panX = 0f, panY = 0f)
        } else {
            state.copy(zoom = next)
        }
    }

    /** Resets zoom to 1× and clears the pan (web `zoomReset`, the `0` key). */
    fun zoomReset(state: LightboxViewerState): LightboxViewerState = state.copy(zoom = LightboxRegistration.MIN_ZOOM, panX = 0f, panY = 0f)

    /**
     * Accumulates a drag delta into the pan offset — ignored unless zoomed, mirroring the web
     * `handlePointerDown` guard (`if (zoom <= 1) return`).
     */
    fun pan(
        state: LightboxViewerState,
        deltaX: Float,
        deltaY: Float,
    ): LightboxViewerState = if (!state.isZoomed) state else state.copy(panX = state.panX + deltaX, panY = state.panY + deltaY)

    /** Marks the active image decoded — idempotent (web `onLoad`/`onError` → `setDecoded(true)`). */
    fun markDecoded(state: LightboxViewerState): LightboxViewerState = if (state.decoded) state else state.copy(decoded = true)

    /**
     * Maps the bound feed's [state] to the shell's [LightboxFreshness] chip — honest freshness so a cached
     * gallery served after a stale TTL or a failed fetch is flagged, never shown as live.
     */
    fun freshness(state: UiState<*>): LightboxFreshness =
        when {
            state.isOffline && state.errorKind != null -> LightboxFreshness.Offline
            state.stale -> LightboxFreshness.Stale
            else -> LightboxFreshness.Live
        }

    /**
     * Maps the bound feed's hard-error [state] onto the shared [QueryErrorKind] recovery bucket so the
     * surface's error branch shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a
     * connectivity failure → [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 →
     * [QueryErrorKind.NotFound]; every other failure → [QueryErrorKind.ServerError] with a retry.
     */
    fun queryErrorKind(state: UiState<*>): QueryErrorKind =
        when (state.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (state.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}
