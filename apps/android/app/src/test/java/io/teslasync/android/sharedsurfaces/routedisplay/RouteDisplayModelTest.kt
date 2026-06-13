package io.teslasync.android.sharedsurfaces.routedisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the RouteDisplay's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/data-display/RouteDisplay.tsx + its `endpointLabel` /
 * `RouteDisplay.test.tsx` vectors): the address-or-coordinate label, the haversine round-trip tie-breaker,
 * and the four render branches (no-location / from→to / matched round trip / explicit single). Because the
 * composable is a thin render layer over [projectRouteDisplay], the per-branch assertions here double as the
 * surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate. The strings are pinned to the
 * English catalog values so the assertions never depend on the host machine's locale.
 */
class RouteDisplayModelTest {
    private val strings = RouteDisplayStrings(noLocationData = "No location data", roundTrip = "round trip")

    private fun project(
        start: RouteEndpoint,
        end: RouteEndpoint?,
        threshold: Double = DEFAULT_ROUND_TRIP_THRESHOLD_M,
    ): RouteDisplayProjection = projectRouteDisplay(start, end, threshold, strings)

    // ── endpointLabel: address → trimmed address → "📍 lat, lon" → null ───────────────────────────────────

    @Test
    fun endpointLabelReturnsTheAddressWhenPresent() {
        assertEquals("Home", endpointLabel(RouteEndpoint(address = "Home")))
    }

    @Test
    fun endpointLabelTrimsSurroundingWhitespace() {
        assertEquals("Home", endpointLabel(RouteEndpoint(address = "  Home  ")))
    }

    @Test
    fun endpointLabelFallsBackToCoordsWhenAddressMissing() {
        // web: endpointLabel({ lat: 47.71, lon: -122.18 }) === '📍 47.71, -122.18'.
        assertEquals("$ROUTE_COORD_PIN 47.71, -122.18", endpointLabel(RouteEndpoint(lat = 47.71, lon = -122.18)))
    }

    @Test
    fun endpointLabelIsNullWhenNeitherAddressNorCoordsPresent() {
        assertNull(endpointLabel(RouteEndpoint()))
        assertNull(endpointLabel(RouteEndpoint(address = "   ")))
        assertNull(endpointLabel(RouteEndpoint(lat = null, lon = null)))
    }

    @Test
    fun endpointLabelCoordsUseADotDecimalRegardlessOfDeviceLocale() {
        // web `toFixed(2)` is locale-independent; a comma-decimal device locale must not change the label.
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.GERMANY)
            assertEquals(
                "$ROUTE_COORD_PIN 47.71, -122.18",
                endpointLabel(RouteEndpoint(lat = 47.71, lon = -122.18)),
            )
        } finally {
            Locale.setDefault(previous)
        }
    }

    // ── point to point (web "{start} → {end}") ────────────────────────────────────────────────────────────

    @Test
    fun rendersFromToWhenStartAndEndDiffer() {
        val projection = project(RouteEndpoint(address = "Home"), RouteEndpoint(address = "Office"))
        assertEquals(RouteDisplayKind.PointToPoint, projection.kind)
        assertEquals("Home $ROUTE_ARROW Office", projection.text)
    }

    // ── round trip when the two address labels match (web `addressesMatch`) ───────────────────────────────

    @Test
    fun rendersRoundTripWhenAddressesMatch() {
        val projection = project(RouteEndpoint(address = "Home"), RouteEndpoint(address = "Home"))
        assertEquals(RouteDisplayKind.RoundTrip, projection.kind)
        assertEquals("Home $ROUTE_ROUND_TRIP_GLYPH round trip", projection.text)
    }

    // ── round trip when coordinates are within the threshold (web `coordsClose`) ──────────────────────────

    @Test
    fun rendersRoundTripWhenCoordsWithinThreshold() {
        val point = RouteEndpoint(lat = 47.71, lon = -122.18)
        val projection = project(point, point)
        assertEquals(RouteDisplayKind.RoundTrip, projection.kind)
        assertTrue(projection.text.contains("round trip"))
    }

    @Test
    fun doesNotRenderRoundTripWhenCoordsFarApart() {
        // web: ~10 km apart → both coords rendered, no round-trip phrasing.
        val projection = project(RouteEndpoint(lat = 47.71, lon = -122.18), RouteEndpoint(lat = 47.80, lon = -122.18))
        assertEquals(RouteDisplayKind.PointToPoint, projection.kind)
        assertTrue(projection.text.contains(ROUTE_ARROW))
        assertFalse(projection.text.contains("round trip"))
    }

    // ── explicit single location (no end) — just the start, no "round trip" / no arrow ────────────────────

    @Test
    fun rendersSingleLocationWithoutRoundTripPhrasing() {
        val projection = project(RouteEndpoint(address = "Supercharger Costco"), null)
        assertEquals(RouteDisplayKind.RoundTrip, projection.kind)
        assertEquals("Supercharger Costco", projection.text)
        assertFalse(projection.text.contains("round trip"))
        assertFalse(projection.text.contains(ROUTE_ARROW))
    }

    // ── no location at all (web `!startLabel && !endLabel`) ───────────────────────────────────────────────

    @Test
    fun fallsBackToNoLocationDataWhenNeitherEndpointHasData() {
        val projection = project(RouteEndpoint(), RouteEndpoint())
        assertEquals(RouteDisplayKind.NoLocation, projection.kind)
        assertEquals("No location data", projection.text)
    }

    // ── per-endpoint fallback when only one side is missing (web `?? noLocation`) ─────────────────────────

    @Test
    fun fallsBackPerEndpointWhenOnlyTheEndIsMissing() {
        val projection = project(RouteEndpoint(address = "Home"), RouteEndpoint())
        assertEquals(RouteDisplayKind.PointToPoint, projection.kind)
        assertEquals("Home $ROUTE_ARROW No location data", projection.text)
    }

    @Test
    fun fallsBackPerEndpointWhenOnlyTheStartIsMissing() {
        val projection = project(RouteEndpoint(), RouteEndpoint(address = "Office"))
        assertEquals(RouteDisplayKind.PointToPoint, projection.kind)
        assertEquals("No location data $ROUTE_ARROW Office", projection.text)
    }

    // ── custom roundTripThresholdM (web vectors: ~122 m apart, differing rounded labels) ──────────────────

    @Test
    fun respectsCustomRoundTripThreshold() {
        val start = RouteEndpoint(lat = 47.7144, lon = -122.18)
        val end = RouteEndpoint(lat = 47.7155, lon = -122.18)
        assertEquals(RouteDisplayKind.PointToPoint, project(start, end).kind)
        assertEquals(RouteDisplayKind.RoundTrip, project(start, end, threshold = 200.0).kind)
    }

    // ── haversine agrees with the web formula at the threshold boundary ───────────────────────────────────

    @Test
    fun haversineIsZeroForIdenticalPointsAndAboutOneHundredMetresForTheCustomVectors() {
        assertEquals(0.0, haversineMeters(47.71, -122.18, 47.71, -122.18), 1e-6)
        val meters = haversineMeters(47.7144, -122.18, 47.7155, -122.18)
        assertTrue("expected ~122 m, was $meters", meters in 100.0..150.0)
    }
}
