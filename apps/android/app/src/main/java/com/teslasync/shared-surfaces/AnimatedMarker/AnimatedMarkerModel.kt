// Pure, framework-free model + projection + diagnostics for the AnimatedMarker shared surface — the native
// analogue of every decision the web component makes (web/src/components/maps/AnimatedMarker.tsx) before it
// paints its smoothly-moving, pulsing vehicle marker. No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer over these pure functions (the accepted sibling-surface contract — AnimatedNumber,
// TimeMarker).
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURELY PRESENTATIONAL Leaflet `<Marker>` whose only inputs are props: `position` ([lat, lng]),
//     an optional `heading` (degrees), and a `color` (default `#00b4d8`, which is the app's `custom_primary`
//     brand color → the Material primary token natively). There is no data fetch, so there is no
//     loading / empty / error / stale / offline lifecycle to model — inventing one would fabricate behaviour
//     the web spec does not have (honesty covenant: no scope narrowing, no silent drift), exactly as the
//     sibling presentational surfaces (AnimatedNumber, TimeMarker) document.
//   • `useMap()` is React-Leaflet's MAP CONTROLLER context, not a TanStack-Query data hook; the component
//     uses it solely to `map.panTo(target)` when the marker leaves the current viewport. The native analogue
//     is the maps-compose `CameraPositionState` the host hands the marker (its `useMap` binding); the
//     pan-when-out-of-view decision is the pure [shouldPanToTarget] reducer here.
//   • Smooth movement: the web calls `marker.setLatLng(target)` on every `position` change (Leaflet owns the
//     glide). The native marker interpolates between the previous and target coordinate; [markerPositionAt]
//     is that pure interpolation, so the eased path is verifiable off-device.
//   • The pulsing halo: the web icon's halo carries `animation:replay-pulse 1.5s ease-in-out infinite` over a
//     base `opacity:0.3`. The `replay-pulse` keyframe is UNDEFINED anywhere in the web source (so it is a
//     no-op there); the sibling `vehicleIcon.ts` defines the INTENDED pulse `vehicle-pulse`
//     (`0/100% → scale(1) opacity(rest); 50% → scale(1.6) opacity(0)`). This model reproduces that documented
//     design intent over AnimatedMarker's own 1.5s period and 0.3 rest opacity ([pulseIntensityForStep],
//     [haloScaleAt], [haloAlphaAt]); the composable holds reduced motion at the rest frame, which equals the
//     static halo the web currently renders, so the surface is honest whether or not it animates.
//   • Heading: the web applies the rotation to the inner CIRCLE, which is radially symmetric, so the rotation
//     is visually negligible — the heading prop is preserved for API parity and applied to the (symmetric)
//     core glyph in the render layer, faithfully matching the web's behaviour rather than inventing an arrow
//     (the directional arrow is the separate atomic `AnimatedVehicleMarker`, out of scope here).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AnimatedMarker — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.animatedmarker

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapBounds
import io.teslasync.android.components.maps.lerpDouble
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs

/**
 * Canonical registry metadata for the AnimatedMarker surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`AnimatedMarker`).
 */
object AnimatedMarkerRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "animated-marker"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "AnimatedMarker"
}

/**
 * The web-default knobs and icon geometry, kept as named constants so the composable and the unit gate agree
 * on one source of truth — no loose numerals drift between the render layer and its tests. Values mirror the
 * web icon (`web/src/components/maps/AnimatedMarker.tsx`) and the documented pulse intent
 * (`web/src/components/maps/vehicleIcon.ts`).
 */
object AnimatedMarkerDefaults {
    /** Halo pulse period — web `animation:replay-pulse 1.5s`. */
    const val PULSE_PERIOD_MS: Long = 1_500L

    /** Quantization of one pulse period into MarkerComposable bitmap frames (gentle ~8 fps, low icon churn). */
    const val PULSE_STEPS: Int = 12

    /** Halo opacity at the resting frame — web halo `opacity:0.3`. */
    const val HALO_REST_ALPHA: Float = 0.3f

    /** Halo opacity at the pulse peak — intent `vehicle-pulse` `50% { opacity: 0 }`. */
    const val HALO_PEAK_ALPHA: Float = 0.0f

    /** Halo scale at the resting frame — intent `vehicle-pulse` `0/100% { scale(1) }`. */
    const val HALO_REST_SCALE: Float = 1.0f

    /** Halo scale at the pulse peak — intent `vehicle-pulse` `50% { scale(1.6) }`. */
    const val HALO_PEAK_SCALE: Float = 1.6f

    /** Position glide duration — web `map.panTo(target, { animate: true, duration: 0.3 })`. */
    const val POSITION_ANIM_MS: Int = 300

    /** Icon container edge in dp — web `iconSize:[24,24]`. */
    const val ICON_SIZE_DP: Int = 24

    /** Inner core inset in dp — web inner circle `inset:4px`. */
    const val CORE_INSET_DP: Int = 4

    /** Inner core border width in dp — web inner circle `border:2px solid white`. */
    const val CORE_BORDER_DP: Int = 2

    /** Core glow radius in dp — web inner circle `box-shadow:0 0 8px color`. */
    const val GLOW_RADIUS_DP: Int = 8

    /** Sentinel heading meaning "no heading supplied" (web `heading == null`), used as a MarkerComposable key. */
    const val NO_HEADING: Double = -1.0
}

/**
 * Interpolated marker coordinate at [fraction] (0..1) of the glide from [start] to [end] — the native mirror
 * of the web `marker.setLatLng(target)` smooth move (Leaflet owns the transform; the render layer drives the
 * fraction). [fraction] is clamped to `0..1` by [lerpDouble], so the path never overshoots either endpoint.
 */
fun markerPositionAt(
    start: GeoPoint,
    end: GeoPoint,
    fraction: Float,
): GeoPoint =
    GeoPoint(
        lat = lerpDouble(start.lat, end.lat, fraction),
        lng = lerpDouble(start.lng, end.lng, fraction),
    )

/**
 * Ease-in-out-quad easing — the web halo pulse is `ease-in-out`. [t] is clamped to `0..1` so the function is
 * total. Accelerates out of the rest frame and decelerates into the peak, giving the halo its soft breathing
 * cadence rather than a linear blink.
 */
fun easeInOut(t: Double): Double {
    val clamped = t.coerceIn(0.0, 1.0)
    return if (clamped < HALF) {
        2.0 * clamped * clamped
    } else {
        val u = -2.0 * clamped + 2.0
        1.0 - (u * u) / 2.0
    }
}

/**
 * The halo pulse intensity (0 = rest, 1 = peak) for quantized frame [step] of [steps] across one period — the
 * native mirror of the web halo keyframe clock. A symmetric triangle (rest → peak at the half-period → rest)
 * is shaped by [easeInOut], reproducing `replay-pulse`'s `ease-in-out` cadence between the `0%/100%` rest and
 * `50%` peak frames. [step] is taken modulo [steps] so the cycle repeats forever like the web `infinite`.
 */
fun pulseIntensityForStep(
    step: Int,
    steps: Int = AnimatedMarkerDefaults.PULSE_STEPS,
): Double {
    if (steps <= 0) return 0.0
    val half = steps * HALF
    val frame = ((step % steps) + steps) % steps
    val triangle = 1.0 - abs(frame - half) / half
    return easeInOut(triangle)
}

/** Halo scale for a pulse [intensity] (0..1): rest 1.0 → peak 1.6 (intent `vehicle-pulse`). */
fun haloScaleAt(intensity: Double): Float =
    lerpFloat(AnimatedMarkerDefaults.HALO_REST_SCALE, AnimatedMarkerDefaults.HALO_PEAK_SCALE, intensity)

/** Halo opacity for a pulse [intensity] (0..1): rest 0.3 → peak 0.0 (web halo `opacity:0.3` fading out). */
fun haloAlphaAt(intensity: Double): Float =
    lerpFloat(AnimatedMarkerDefaults.HALO_REST_ALPHA, AnimatedMarkerDefaults.HALO_PEAK_ALPHA, intensity)

/**
 * Whether the camera must recenter on [target] to keep the marker visible — the native mirror of the web
 * `if (!map.getBounds().contains(target)) map.panTo(target)`. [visibleBounds] is the current map viewport
 * (null while the map has not laid out / produced a projection yet, in which case panning is deferred — the
 * web map is always ready, so this only guards the pre-layout frame). An invalid [target] never forces a pan.
 */
fun shouldPanToTarget(
    target: GeoPoint,
    visibleBounds: MapBounds?,
): Boolean = visibleBounds != null && target.isValid() && !visibleBounds.contains(target)

/**
 * The marker's accessible label — the [custom] description when the caller supplies a non-blank one, otherwise
 * the localized [default]. The web Leaflet div-icon ships NO accessible text; the native port adds a TalkBack
 * label (the prompt's accessibility requirement) sourced from the i18n catalog, so no English literal ships in
 * native code and the marker is announced to screen-reader users.
 */
fun markerContentDescription(
    custom: String?,
    default: String,
): String = custom?.trim()?.takeIf { it.isNotEmpty() } ?: default

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [SLUG] — never the marker's coordinate, heading, or color, so a diagnostics line can
 * never leak where a vehicle is. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it once per surface open.
 */
object AnimatedMarkerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = AnimatedMarkerRegistration.SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Linear interpolation between [a] and [b] at [t] (0..1, clamped), returned as a Compose-ready Float. */
private fun lerpFloat(
    a: Float,
    b: Float,
    t: Double,
): Float {
    val clamped = t.coerceIn(0.0, 1.0)
    return (a + (b - a) * clamped).toFloat()
}

/** The halfway constant (0.5): the easing midpoint and the half-period pulse peak (the `50%` keyframe). */
private const val HALF: Double = 0.5
