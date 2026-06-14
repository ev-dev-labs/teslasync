// Off-device unit coverage for the AnimatedMarker surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Exercises the prompt-mandated registration slug, the web-default knobs / icon geometry,
// the ease-in-out pulse curve and its quantized intensity (rest → peak → rest, wrapping forever), the halo
// scale / opacity projection (web `replay-pulse` over the documented `vehicle-pulse` intent), the position
// glide interpolation (web `setLatLng`), the `useMap` pan-when-out-of-view decision (web `panTo`), and the
// accessible-label fallback the composable exposes as the marker's contentDescription. No Compose / Android
// framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the numbers + behaviour the web
// `AnimatedMarker` produces.
package io.teslasync.android.sharedsurfaces.animatedmarker

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapBounds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimatedMarkerModelTest {
    private val floatDelta = 1e-4f
    private val doubleDelta = 1e-9

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("animated-marker", AnimatedMarkerRegistration.ID)
        assertEquals("AnimatedMarker", AnimatedMarkerRegistration.SLUG)
    }

    @Test
    fun defaultsMatchTheWebSource() {
        // web `replay-pulse 1.5s`, halo `opacity:0.3`, intent peak scale 1.6, panTo `duration: 0.3` s.
        assertEquals(1_500L, AnimatedMarkerDefaults.PULSE_PERIOD_MS)
        assertEquals(0.3f, AnimatedMarkerDefaults.HALO_REST_ALPHA, floatDelta)
        assertEquals(0.0f, AnimatedMarkerDefaults.HALO_PEAK_ALPHA, floatDelta)
        assertEquals(1.0f, AnimatedMarkerDefaults.HALO_REST_SCALE, floatDelta)
        assertEquals(1.6f, AnimatedMarkerDefaults.HALO_PEAK_SCALE, floatDelta)
        assertEquals(300, AnimatedMarkerDefaults.POSITION_ANIM_MS)
        // web icon geometry: 24px container, inner inset 4px, 2px white border, 0 0 8px glow.
        assertEquals(24, AnimatedMarkerDefaults.ICON_SIZE_DP)
        assertEquals(4, AnimatedMarkerDefaults.CORE_INSET_DP)
        assertEquals(2, AnimatedMarkerDefaults.CORE_BORDER_DP)
        assertEquals(8, AnimatedMarkerDefaults.GLOW_RADIUS_DP)
    }

    // ── ease-in-out pulse curve (web halo `ease-in-out`) ──────────────────────────────

    @Test
    fun easeInOutMatchesTheCurveAndIsTotal() {
        assertEquals(0.0, easeInOut(0.0), doubleDelta)
        assertEquals(0.125, easeInOut(0.25), doubleDelta) // 2 * 0.25^2
        assertEquals(0.5, easeInOut(0.5), doubleDelta)
        assertEquals(0.875, easeInOut(0.75), doubleDelta) // 1 - (0.5^2)/2
        assertEquals(1.0, easeInOut(1.0), doubleDelta)
        // clamped outside 0..1 so the curve never overshoots.
        assertEquals(0.0, easeInOut(-1.0), doubleDelta)
        assertEquals(1.0, easeInOut(2.0), doubleDelta)
    }

    // ── quantized pulse intensity: rest → peak → rest, wrapping forever (web `infinite`) ──

    @Test
    fun pulseIntensityRestsAtFrameZeroAndPeaksAtTheHalfPeriod() {
        assertEquals(0.0, pulseIntensityForStep(0), doubleDelta)
        assertEquals(1.0, pulseIntensityForStep(AnimatedMarkerDefaults.PULSE_STEPS / 2), doubleDelta)
    }

    @Test
    fun pulseIntensityIsSymmetricAroundThePeak() {
        // frame 3 (rising) and frame 9 (falling) of 12 are mirror points of the triangle → equal intensity.
        assertEquals(pulseIntensityForStep(3), pulseIntensityForStep(9), doubleDelta)
    }

    @Test
    fun pulseIntensityWrapsAcrossPeriods() {
        // a full period later is the same frame (web `infinite` loop).
        assertEquals(pulseIntensityForStep(0), pulseIntensityForStep(AnimatedMarkerDefaults.PULSE_STEPS), doubleDelta)
        assertEquals(pulseIntensityForStep(2), pulseIntensityForStep(2 + AnimatedMarkerDefaults.PULSE_STEPS), doubleDelta)
    }

    @Test
    fun pulseIntensityStaysWithinUnitRangeForEveryFrame() {
        for (step in 0 until AnimatedMarkerDefaults.PULSE_STEPS) {
            val intensity = pulseIntensityForStep(step)
            assertTrue("intensity in 0..1 at step=$step", intensity in 0.0..1.0)
        }
    }

    @Test
    fun pulseIntensityIsZeroForNonPositiveSteps() {
        assertEquals(0.0, pulseIntensityForStep(0, steps = 0), doubleDelta)
    }

    // ── halo scale / opacity projection (web halo, `vehicle-pulse` intent) ────────────

    @Test
    fun haloScaleSpansRestToPeak() {
        assertEquals(1.0f, haloScaleAt(0.0), floatDelta)
        assertEquals(1.3f, haloScaleAt(0.5), floatDelta)
        assertEquals(1.6f, haloScaleAt(1.0), floatDelta)
    }

    @Test
    fun haloAlphaFadesFromRestToTransparent() {
        // web halo `opacity:0.3` at rest, fading to 0 at the pulse peak.
        assertEquals(0.3f, haloAlphaAt(0.0), floatDelta)
        assertEquals(0.15f, haloAlphaAt(0.5), floatDelta)
        assertEquals(0.0f, haloAlphaAt(1.0), floatDelta)
    }

    @Test
    fun haloProjectionClampsOutOfRangeIntensity() {
        assertEquals(1.0f, haloScaleAt(-1.0), floatDelta)
        assertEquals(1.6f, haloScaleAt(2.0), floatDelta)
        assertEquals(0.3f, haloAlphaAt(-1.0), floatDelta)
        assertEquals(0.0f, haloAlphaAt(2.0), floatDelta)
    }

    // ── position glide interpolation (web `marker.setLatLng(target)`) ─────────────────

    @Test
    fun markerPositionGlidesFromStartToTarget() {
        val start = GeoPoint(40.0, -70.0)
        val end = GeoPoint(42.0, -74.0)
        assertEquals(start.lat, markerPositionAt(start, end, 0f).lat, doubleDelta)
        assertEquals(start.lng, markerPositionAt(start, end, 0f).lng, doubleDelta)
        assertEquals(41.0, markerPositionAt(start, end, 0.5f).lat, doubleDelta)
        assertEquals(-72.0, markerPositionAt(start, end, 0.5f).lng, doubleDelta)
        assertEquals(end.lat, markerPositionAt(start, end, 1f).lat, doubleDelta)
        assertEquals(end.lng, markerPositionAt(start, end, 1f).lng, doubleDelta)
    }

    @Test
    fun markerPositionClampsFractionToTheEndpoints() {
        val start = GeoPoint(0.0, 0.0)
        val end = GeoPoint(10.0, 20.0)
        // fraction past the ends never overshoots (lerpDouble clamps 0..1).
        assertEquals(0.0, markerPositionAt(start, end, -1f).lat, doubleDelta)
        assertEquals(10.0, markerPositionAt(start, end, 2f).lat, doubleDelta)
        assertEquals(20.0, markerPositionAt(start, end, 2f).lng, doubleDelta)
    }

    // ── `useMap` pan-when-out-of-view decision (web `!map.getBounds().contains(target)`) ──

    private val viewport = MapBounds(south = 39.0, west = -75.0, north = 41.0, east = -71.0)

    @Test
    fun noPanWhenTargetIsInsideTheViewport() {
        assertFalse(shouldPanToTarget(GeoPoint(40.0, -73.0), viewport))
    }

    @Test
    fun panWhenTargetLeavesTheViewport() {
        assertTrue(shouldPanToTarget(GeoPoint(45.0, -73.0), viewport)) // north of the box
        assertTrue(shouldPanToTarget(GeoPoint(40.0, -60.0), viewport)) // east of the box
    }

    @Test
    fun noPanWhenTheProjectionIsNotReadyYet() {
        // web map is always ready; null bounds is the pre-layout frame, which defers panning.
        assertFalse(shouldPanToTarget(GeoPoint(45.0, -73.0), null))
    }

    @Test
    fun noPanForAnInvalidTarget() {
        assertFalse(shouldPanToTarget(GeoPoint(200.0, 999.0), viewport))
    }

    // ── a11y label fallback: the composable sets this as the marker's contentDescription ──

    @Test
    fun contentDescriptionPrefersTheCustomLabel() {
        assertEquals("Lead car", markerContentDescription("Lead car", "Vehicle"))
        assertEquals("Truck", markerContentDescription("  Truck  ", "Vehicle"))
    }

    @Test
    fun contentDescriptionFallsBackToTheLocalizedDefault() {
        // web ships no accessible text; the native default comes from the i18n catalog ("Vehicle").
        assertEquals("Vehicle", markerContentDescription(null, "Vehicle"))
        assertEquals("Vehicle", markerContentDescription("   ", "Vehicle"))
    }
}
