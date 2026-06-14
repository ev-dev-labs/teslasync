package io.teslasync.android.widgetprimitives.widgetmapview

import io.teslasync.android.components.maps.GeoPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetMapView frame's pure logic — the native mirror of the render decisions the
 * web component makes (web/src/features/dashboard/widgets/shared/WidgetMapView.tsx) before Compose paints
 * anything: which region shows ([widgetMapViewPlan]), how the pan / zoom interactions are gated by compact
 * ([widgetMapInteraction]), and how the camera center / zoom are resolved + guarded
 * ([resolveWidgetMapCenter] / [resolveWidgetMapZoom]). Because the composable is a thin render layer over these
 * projections, the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class WidgetMapViewModelTest {
    // ── widgetMapViewPlan: the per-state snapshot (web isEmpty vs map) ─────────────────────────────────────

    @Test
    fun emptyShowsOnlyTheEmptyState() {
        val plan = widgetMapViewPlan(isEmpty = true)
        assertTrue(plan.showEmptyState)
        assertFalse(plan.showMap)
        assertTrue(plan.rendersAnyRegion)
    }

    @Test
    fun populatedShowsOnlyTheMap() {
        val plan = widgetMapViewPlan(isEmpty = false)
        assertFalse(plan.showEmptyState)
        assertTrue(plan.showMap)
        assertTrue(plan.rendersAnyRegion)
    }

    @Test
    fun everyBranchRendersExactlyOneRegionSoTheFrameIsNeverBlank() {
        listOf(true, false).forEach { isEmpty ->
            val plan = widgetMapViewPlan(isEmpty)
            assertTrue("a region must always render", plan.rendersAnyRegion)
            assertTrue("regions are mutually exclusive", plan.showEmptyState != plan.showMap)
        }
    }

    // ── widgetMapInteraction: the web `!compact` gating of dragging / scrollWheelZoom / zoomControl ─────────

    @Test
    fun wideFrameEnablesEveryInteraction() {
        val interaction = widgetMapInteraction(compact = false)
        assertTrue(interaction.dragging)
        assertTrue(interaction.scrollWheelZoom)
        assertTrue(interaction.zoomControl)
        assertTrue(interaction.interactive)
    }

    @Test
    fun compactFrameDisablesEveryInteraction() {
        val interaction = widgetMapInteraction(compact = true)
        assertFalse(interaction.dragging)
        assertFalse(interaction.scrollWheelZoom)
        assertFalse(interaction.zoomControl)
        assertFalse(interaction.interactive)
    }

    // ── resolveWidgetMapZoom: web `zoom = 13` default + camera-envelope clamp ──────────────────────────────

    @Test
    fun defaultZoomMatchesTheWebDefault() {
        assertEquals(13f, DEFAULT_WIDGET_MAP_ZOOM, 0f)
    }

    @Test
    fun inBandZoomIsUnchanged() {
        assertEquals(13f, resolveWidgetMapZoom(13f), 0f)
        assertEquals(7.5f, resolveWidgetMapZoom(7.5f), 0f)
    }

    @Test
    fun zoomBelowTheMinimumIsClampedUp() {
        assertEquals(MIN_WIDGET_MAP_ZOOM, resolveWidgetMapZoom(-4f), 0f)
        assertEquals(MIN_WIDGET_MAP_ZOOM, resolveWidgetMapZoom(0f), 0f)
    }

    @Test
    fun zoomAboveTheMaximumIsClampedDown() {
        assertEquals(MAX_WIDGET_MAP_ZOOM, resolveWidgetMapZoom(99f), 0f)
    }

    @Test
    fun nonFiniteZoomFallsBackToTheDefault() {
        assertEquals(DEFAULT_WIDGET_MAP_ZOOM, resolveWidgetMapZoom(Float.NaN), 0f)
        assertEquals(DEFAULT_WIDGET_MAP_ZOOM, resolveWidgetMapZoom(Float.POSITIVE_INFINITY), 0f)
        assertEquals(DEFAULT_WIDGET_MAP_ZOOM, resolveWidgetMapZoom(Float.NEGATIVE_INFINITY), 0f)
    }

    @Test
    fun theZoomEnvelopeIsOrdered() {
        assertTrue(MIN_WIDGET_MAP_ZOOM < DEFAULT_WIDGET_MAP_ZOOM)
        assertTrue(DEFAULT_WIDGET_MAP_ZOOM < MAX_WIDGET_MAP_ZOOM)
    }

    // ── resolveWidgetMapCenter: web parity for a valid center, safe fallback for a malformed one ───────────

    @Test
    fun validCenterIsUsedVerbatim() {
        val center = GeoPoint(lat = 37.7749, lng = -122.4194)
        assertEquals(center, resolveWidgetMapCenter(center))
    }

    @Test
    fun nonFiniteCenterFallsBackToTheNeutralWorldView() {
        assertEquals(WIDGET_MAP_FALLBACK_CENTER, resolveWidgetMapCenter(GeoPoint(Double.NaN, 0.0)))
        assertEquals(WIDGET_MAP_FALLBACK_CENTER, resolveWidgetMapCenter(GeoPoint(0.0, Double.NaN)))
    }

    @Test
    fun outOfEnvelopeCenterFallsBackToTheNeutralWorldView() {
        assertEquals(WIDGET_MAP_FALLBACK_CENTER, resolveWidgetMapCenter(GeoPoint(200.0, 0.0)))
        assertEquals(WIDGET_MAP_FALLBACK_CENTER, resolveWidgetMapCenter(GeoPoint(0.0, 400.0)))
    }

    @Test
    fun theFallbackCenterIsItselfValid() {
        assertTrue(WIDGET_MAP_FALLBACK_CENTER.isValid())
    }

    // ── registration / slug contract ──────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("WidgetMapView", WIDGET_MAP_VIEW_SLUG)
        assertEquals("WidgetMapView", WidgetMapViewRegistration.SLUG)
        assertEquals("widget-map-view", WidgetMapViewRegistration.ID)
    }
}
