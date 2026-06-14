// The native Jetpack Compose + Material 3 AnimatedMarker shared surface — a parity port of the web Leaflet
// marker web/src/components/maps/AnimatedMarker.tsx. The web component renders a vehicle marker that smoothly
// transitions between positions (`marker.setLatLng(target)`), paints a pulsing colored halo over a
// white-bordered, glowing core (rotated by an optional `heading`), and uses `useMap()` purely to
// `map.panTo(target)` when the marker leaves the viewport. Every pure decision — the pulse cadence, the
// position glide interpolation, the pan-when-out-of-view test, and the accessible-label fallback — lives in
// AnimatedMarkerModel.kt and is unit-tested off-device; this file is the thin render layer that drives the
// animation clock, the camera, and the Canvas glyph.
//
// Native mapping (documented for parity, no silent drift):
//   • `useMap()` (React-Leaflet map controller) → the maps-compose [CameraPositionState] the host hands the
//     marker; [shouldPanToTarget] reproduces `if (!map.getBounds().contains(target)) map.panTo(target)`.
//   • marker render → the atomic maps layer's `MarkerComposable`, with a Compose-drawn glyph instead of a
//     packaged bitmap, so the marker icon is real, token-colored Compose content.
//   • smooth move → an [Animatable] glide through the tested [markerPositionAt] reducer; reduced motion snaps,
//     mirroring Leaflet's instant `setLatLng` while staying respectful of the OS animation setting.
//   • pulse → a timer-stepped intensity ([pulseIntensityForStep]) keyed into `MarkerComposable` so the icon
//     bitmap breathes; reduced motion holds the resting frame, which equals the static halo the web (whose
//     `replay-pulse` keyframe is undefined) actually renders today.
//   • `color` (web default `#00b4d8`, the app `custom_primary` brand color) → `MaterialTheme.colorScheme
//     .primary` by default (a token, never a raw hex), overridable by the caller.
//   • heading → applied as a rotation of the (radially symmetric) core, exactly as the web rotates its inner
//     circle; the rotation is visually negligible on a circle, faithfully matching the web rather than
//     inventing a directional arrow (that is the separate atomic `AnimatedVehicleMarker`).
//
// The web marker has no async feed, so — like the accepted AnimatedNumber / TimeMarker presentational ports —
// there is no loading / empty / error / stale / offline lifecycle; its real, fully-reproduced states are the
// heading-known vs heading-unknown glyph, the pulsing vs reduced-motion-static halo, the default vs custom
// color, and the in-view vs panned camera. It performs NO HTTP and emits one PII-safe `view.opened` (P1/S11).
//
// `MapsComposeExperimentalApi` is opted in for `MarkerComposable` (the atomic maps layer opts in the same
// way). `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AnimatedMarker) cannot form a valid Kotlin package, exactly as the sibling
// surfaces do.
@file:OptIn(MapsComposeExperimentalApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.animatedmarker

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.MapsComposeExperimentalApi
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberMarkerState
import io.teslasync.android.R
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapBounds
import io.teslasync.android.components.maps.toGeoPoint
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * An animated, pulsing vehicle marker placed inside a `TeslaMap { … }` (or any `GoogleMap`) content slot — the
 * faithful Android port of the web `<AnimatedMarker>`. It glides to each new [position], breathes a colored
 * halo, paints a white-bordered glowing core rotated by [headingDegrees], and recenters the [cameraPositionState]
 * (its `useMap` binding) whenever the marker would leave the viewport. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) and performs no HTTP.
 *
 * @param position the marker's WGS-84 coordinate (web `position` prop); the marker glides here on change.
 * @param cameraPositionState the host's map camera (web `useMap()`); panned to keep the marker visible.
 * @param headingDegrees optional heading (0 = north, clockwise), rotating the symmetric core (web `heading`).
 * @param color the marker color; defaults to the brand primary token (web default `#00b4d8` = `custom_primary`).
 * @param contentDescription the TalkBack label; defaults to the localized "Vehicle" (web ships none).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
@GoogleMapComposable
@Suppress("DEPRECATION")
fun AnimatedMarker(
    position: GeoPoint,
    cameraPositionState: CameraPositionState,
    headingDegrees: Double? = null,
    color: Color = MaterialTheme.colorScheme.primary,
    contentDescription: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AnimatedMarkerDiagnostics.recordViewOpened(logger) }

    val reduce = rememberReducedMotion()
    val resolvedLabel = markerContentDescription(contentDescription, stringResource(R.string.translation_Vehicle))

    // Manual (deprecated) marker state: the position is driven each frame at double precision, which the
    // auto-updating `rememberUpdatedMarkerState` would override (the atomic AnimatedVehicleMarker does the same).
    val markerState = rememberMarkerState(position = position.toLatLng())
    LaunchedEffect(position.lat, position.lng, reduce) {
        if (reduce) {
            markerState.position = position.toLatLng()
        } else {
            val start = markerState.position.toGeoPoint()
            Animatable(0f).animateTo(1f, tween(AnimatedMarkerDefaults.POSITION_ANIM_MS)) {
                markerState.position = markerPositionAt(start, position, value).toLatLng()
            }
        }
    }

    // The `useMap` pan-to-keep-in-view: recenter only when the target leaves the current viewport (web panTo).
    LaunchedEffect(position.lat, position.lng) {
        val bounds =
            cameraPositionState.projection
                ?.visibleRegion
                ?.latLngBounds
                ?.toMapBounds()
        if (shouldPanToTarget(position, bounds)) {
            runCatching {
                cameraPositionState.animate(
                    CameraUpdateFactory.newLatLng(position.toLatLng()),
                    AnimatedMarkerDefaults.POSITION_ANIM_MS,
                )
            }
        }
    }

    // The halo pulse clock: advance one quantized frame per slice of the period; reduced motion stays at rest.
    var pulseStep by remember { mutableIntStateOf(0) }
    LaunchedEffect(reduce) {
        if (!reduce) {
            val frameMs = (AnimatedMarkerDefaults.PULSE_PERIOD_MS / AnimatedMarkerDefaults.PULSE_STEPS).coerceAtLeast(1L)
            while (isActive) {
                delay(frameMs)
                pulseStep = (pulseStep + 1) % AnimatedMarkerDefaults.PULSE_STEPS
            }
        }
    }
    val intensity = if (reduce) 0.0 else pulseIntensityForStep(pulseStep)
    val haloScale = haloScaleAt(intensity)
    val haloAlpha = haloAlphaAt(intensity)

    MarkerComposable(
        color,
        headingDegrees ?: AnimatedMarkerDefaults.NO_HEADING,
        pulseStep,
        contentDescription = resolvedLabel,
        state = markerState,
        anchor = Offset(GLYPH_ANCHOR, GLYPH_ANCHOR),
        title = resolvedLabel,
    ) {
        AnimatedMarkerGlyph(
            color = color,
            headingDegrees = headingDegrees,
            haloScale = haloScale,
            haloAlpha = haloAlpha,
        )
    }
}

/**
 * The marker icon — the test/preview-friendly render of the web div-icon: a pulsing colored [haloScale] /
 * [haloAlpha] halo, a soft glow (web `box-shadow`), and a white-bordered colored core rotated by
 * [headingDegrees] (web inner circle). Stateless and parameter-driven so previews can show every visual frame
 * without a live map or animation clock.
 */
@Composable
fun AnimatedMarkerGlyph(
    color: Color,
    headingDegrees: Double?,
    haloScale: Float,
    haloAlpha: Float,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.size(GLYPH_CANVAS_DP.dp)) {
        val mid = Offset(size.width / 2f, size.height / 2f)
        val haloRadius = AnimatedMarkerDefaults.ICON_SIZE_DP.dp.toPx() / 2f
        val coreRadius = (AnimatedMarkerDefaults.ICON_SIZE_DP / 2f - AnimatedMarkerDefaults.CORE_INSET_DP).dp.toPx()
        val glowRadius = coreRadius + AnimatedMarkerDefaults.GLOW_RADIUS_DP.dp.toPx()

        // Glow (web `box-shadow:0 0 8px color`) — drawn under the core, so only the soft outer ring shows.
        drawCircle(
            brush =
                Brush.radialGradient(
                    colors = listOf(color.copy(alpha = GLOW_ALPHA), Color.Transparent),
                    center = mid,
                    radius = glowRadius,
                ),
            radius = glowRadius,
            center = mid,
        )

        // Pulsing halo (web halo `opacity:0.3` + `replay-pulse`).
        drawCircle(color = color.copy(alpha = haloAlpha), radius = haloRadius * haloScale, center = mid)

        // White-bordered colored core, rotated by heading (symmetric circle → faithful, negligible rotation).
        rotate(degrees = headingDegrees?.toFloat() ?: 0f, pivot = mid) {
            drawCircle(color = color, radius = coreRadius, center = mid)
            drawCircle(
                color = Color.White,
                radius = coreRadius,
                center = mid,
                style = Stroke(width = AnimatedMarkerDefaults.CORE_BORDER_DP.dp.toPx()),
            )
        }
    }
}

/** Framework-free viewport box for the current camera projection, fed to [shouldPanToTarget]. */
private fun LatLngBounds.toMapBounds(): MapBounds =
    MapBounds(
        south = southwest.latitude,
        west = southwest.longitude,
        north = northeast.latitude,
        east = northeast.longitude,
    )

// ── Previews (tooling-only; each renders the glyph at one of the surface's real visual states) ───────────────
// A live `GoogleMap` cannot render in the @Preview tool, so the previews exercise the stateless glyph — which
// IS the surface's icon — across heading-known / heading-unknown, pulsing peak / resting, and default / custom
// color. The pan + animation clock are covered by the model unit tests.

@Preview(name = "Heading north · resting", showBackground = true)
@Composable
private fun AnimatedMarkerNorthRestingPreview() {
    GlyphPreview(headingDegrees = 0.0, intensity = 0.0)
}

@Preview(name = "Heading east · pulse peak", showBackground = true)
@Composable
private fun AnimatedMarkerEastPeakPreview() {
    GlyphPreview(headingDegrees = 90.0, intensity = 1.0)
}

@Preview(name = "No heading · mid pulse", showBackground = true)
@Composable
private fun AnimatedMarkerNoHeadingPreview() {
    GlyphPreview(headingDegrees = null, intensity = 0.5)
}

@Preview(name = "Custom color · resting", showBackground = true)
@Composable
private fun AnimatedMarkerCustomColorPreview() {
    GlyphPreview(headingDegrees = 135.0, intensity = 0.0, useError = true)
}

@Composable
private fun GlyphPreview(
    headingDegrees: Double?,
    intensity: Double,
    useError: Boolean = false,
) {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Surface {
            Box(modifier = Modifier.padding(GLYPH_PREVIEW_PAD_DP.dp)) {
                AnimatedMarkerGlyph(
                    color = if (useError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    headingDegrees = headingDegrees,
                    haloScale = haloScaleAt(intensity),
                    haloAlpha = haloAlphaAt(intensity),
                )
            }
        }
    }
}

/** Marker icon anchor — center of the glyph (web `iconAnchor:[12,12]` on a 24px icon). */
private const val GLYPH_ANCHOR: Float = 0.5f

/** Glyph canvas edge in dp — large enough to contain the peak (1.6×) halo plus the glow without clipping. */
private const val GLYPH_CANVAS_DP: Int = 44

/** Inner alpha of the core glow radial gradient (web `box-shadow` softness). */
private const val GLOW_ALPHA: Float = 0.45f

/** Padding around the glyph in previews so the pulsing halo is not clipped by the preview frame. */
private const val GLYPH_PREVIEW_PAD_DP: Int = 12
