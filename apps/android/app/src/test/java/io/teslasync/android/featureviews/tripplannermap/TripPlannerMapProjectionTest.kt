package io.teslasync.android.featureviews.tripplannermap

import io.teslasync.android.components.maps.GeoPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TripPlannerMap's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/TripPlannerMap.tsx): the route polyline points (the
 * legs walk, or the straight origin→destination line), the centre fallback chain, the zoom ladder, the
 * charge-stop popup formatting, and the assembled markers + accessible summary. Because the surface is
 * presentational, each projected value is exactly what the thin composable renders.
 */
class TripPlannerMapProjectionTest {
    private fun strings(): TripPlannerMapStrings =
        TripPlannerMapStrings(
            origin = "Origin",
            destination = "Destination",
            empty = "Enter origin and destination to see the route",
        )

    private val home = TripLocation(lat = 47.610, lng = -122.330, name = "Home")
    private val work = TripLocation(lat = 47.620, lng = -122.345, name = "Work")

    // ── hasData ──────────────────────────────────────────────────────────────────

    @Test
    fun hasDataIsTrueWhenEitherEndpointExists() {
        assertTrue(TripPlannerMapProjection.hasData(home, work))
        assertTrue(TripPlannerMapProjection.hasData(home, null))
        assertTrue(TripPlannerMapProjection.hasData(null, work))
        assertFalse(TripPlannerMapProjection.hasData(null, null))
    }

    // ── routePoints: the web polylinePoints memo ─────────────────────────────────

    @Test
    fun routePointsIsTheStraightLineWhenNoLegsButBothEndpointsExist() {
        val points = TripPlannerMapProjection.routePoints(emptyList(), home, work)
        assertEquals(listOf(GeoPoint(47.610, -122.330), GeoPoint(47.620, -122.345)), points)
    }

    @Test
    fun routePointsWalksTheLegsSeedingTheFirstFromThenEachTo() {
        val mid = TripLocation(lat = 47.615, lng = -122.338, name = "Mid")
        val legs = listOf(TripLeg(from = home, to = mid), TripLeg(from = mid, to = work))
        val points = TripPlannerMapProjection.routePoints(legs, home, work)
        assertEquals(
            listOf(GeoPoint(47.610, -122.330), GeoPoint(47.615, -122.338), GeoPoint(47.620, -122.345)),
            points,
        )
    }

    @Test
    fun routePointsIsEmptyWithNoLegsAndAMissingEndpoint() {
        assertTrue(TripPlannerMapProjection.routePoints(emptyList(), home, null).isEmpty())
        assertTrue(TripPlannerMapProjection.routePoints(emptyList(), null, null).isEmpty())
    }

    // ── center: the web center memo ──────────────────────────────────────────────

    @Test
    fun centerIsTheMidpointWhenBothEndpointsExist() {
        val center = TripPlannerMapProjection.center(TripLocation(10.0, 20.0), TripLocation(30.0, 40.0))
        assertEquals(20.0, center.lat, 1e-9)
        assertEquals(30.0, center.lng, 1e-9)
    }

    @Test
    fun centerIsTheOriginWhenOnlyOriginExists() {
        assertEquals(GeoPoint(10.0, 20.0), TripPlannerMapProjection.center(TripLocation(10.0, 20.0), null))
    }

    @Test
    fun centerFallsBackToTheUsCentreForADestinationOnlyOrEmptyForm() {
        val destinationOnly = TripPlannerMapProjection.center(null, TripLocation(30.0, 40.0))
        assertEquals(FALLBACK_CENTER_LAT, destinationOnly.lat, 1e-9)
        assertEquals(FALLBACK_CENTER_LNG, destinationOnly.lng, 1e-9)
        val empty = TripPlannerMapProjection.center(null, null)
        assertEquals(GeoPoint(FALLBACK_CENTER_LAT, FALLBACK_CENTER_LNG), empty)
    }

    // ── zoom: the web zoom ladder ────────────────────────────────────────────────

    @Test
    fun zoomIsTheDefaultWhenAnEndpointIsMissing() {
        assertEquals(ZOOM_DEFAULT, TripPlannerMapProjection.zoom(home, null))
        assertEquals(ZOOM_DEFAULT, TripPlannerMapProjection.zoom(null, work))
        assertEquals(ZOOM_DEFAULT, TripPlannerMapProjection.zoom(null, null))
    }

    @Test
    fun zoomFollowsTheWebSpanLadderOnTheLargerAxis() {
        val origin = TripLocation(0.0, 0.0)
        assertEquals(ZOOM_CONTINENT, TripPlannerMapProjection.zoom(origin, TripLocation(25.0, 0.0)))
        assertEquals(ZOOM_WIDE, TripPlannerMapProjection.zoom(origin, TripLocation(0.0, 15.0)))
        assertEquals(ZOOM_REGION, TripPlannerMapProjection.zoom(origin, TripLocation(7.0, 0.0)))
        assertEquals(ZOOM_AREA, TripPlannerMapProjection.zoom(origin, TripLocation(0.0, 3.0)))
        assertEquals(ZOOM_CLOSE, TripPlannerMapProjection.zoom(origin, TripLocation(1.0, 0.5)))
    }

    // ── chargeStopDetail: the web popup format ───────────────────────────────────

    @Test
    fun chargeStopDetailRoundsSocAndDurationLikeMathRound() {
        assertEquals(
            "20% \u2192 81% (25 min)",
            TripPlannerMapProjection.chargeStopDetail(20.4, 80.6, 1500.0),
        )
    }

    @Test
    fun chargeStopDetailCoercesNonFiniteToZero() {
        assertEquals(
            "0% \u2192 0% (0 min)",
            TripPlannerMapProjection.chargeStopDetail(Double.NaN, Double.NaN, Double.POSITIVE_INFINITY),
        )
    }

    // ── project: the assembled content display ───────────────────────────────────

    @Test
    fun projectAssemblesMarkersSummaryAndRouteLabel() {
        val stop =
            TripChargeStop(
                name = "Supercharger",
                location = TripLocation(47.615, -122.338),
                chargeFromSoc = 30.0,
                chargeToSoc = 70.0,
                chargeDurationS = 1800.0,
            )
        val display =
            TripPlannerMapProjection.project(
                TripPlannerMapSnapshot(origin = home, destination = work, chargeStops = listOf(stop)),
                strings(),
            )
        assertTrue(display.hasData)
        assertEquals("Home", display.originMarker?.title)
        assertEquals("Work", display.destinationMarker?.title)
        assertEquals(1, display.chargeMarkers.size)
        assertEquals("Supercharger \u2022 30% \u2192 70% (30 min)", display.chargeMarkers[0].title)
        assertEquals("Home \u2192 Work", display.routeLabel)
        // No legs but both endpoints -> a straight two-point line, so the polyline is drawn.
        assertTrue(display.hasRoute)
        assertEquals(2, display.routePoints.size)
        assertEquals(listOf("Home", "Work", "Supercharger \u2014 30% \u2192 70% (30 min)"), display.summaryLines)
    }

    @Test
    fun projectFallsBackToLocalizedLabelsWhenNamesAreBlank() {
        val display =
            TripPlannerMapProjection.project(
                TripPlannerMapSnapshot(
                    origin = TripLocation(1.0, 2.0, name = null),
                    destination = TripLocation(3.0, 4.0, name = ""),
                ),
                strings(),
            )
        assertEquals("Origin", display.originMarker?.title)
        assertEquals("Destination", display.destinationMarker?.title)
        assertEquals("Origin \u2192 Destination", display.routeLabel)
    }

    @Test
    fun projectWithOriginOnlyHasNoDestinationMarkerOrRoute() {
        val display =
            TripPlannerMapProjection.project(TripPlannerMapSnapshot(origin = home), strings())
        assertTrue(display.hasData)
        assertEquals("Home", display.originMarker?.title)
        assertNull(display.destinationMarker)
        assertFalse(display.hasRoute)
        assertTrue(display.routePoints.isEmpty())
        assertEquals(listOf("Home"), display.summaryLines)
        assertEquals(GeoPoint(47.610, -122.330), display.center)
    }

    @Test
    fun projectWithNeitherEndpointSurfacesTheEmptyState() {
        val display = TripPlannerMapProjection.project(TripPlannerMapSnapshot(), strings())
        assertFalse(display.hasData)
        assertNull(display.originMarker)
        assertNull(display.destinationMarker)
        assertTrue(display.summaryLines.isEmpty())
        assertEquals("Enter origin and destination to see the route", display.emptyText)
    }

    // ── projectUiState: the cache-then-network surface mapping ───────────────────

    @Test
    fun projectUiStateMapsLoadingContentAndEmpty() {
        assertTrue(TripPlannerMapProjection.projectUiState(null, isLoading = true).isLoading)
        assertTrue(
            TripPlannerMapProjection.projectUiState(TripPlannerMapSnapshot(origin = home), isLoading = false).isContent,
        )
        assertTrue(TripPlannerMapProjection.projectUiState(null, isLoading = false).isEmpty)
        assertTrue(TripPlannerMapProjection.projectUiState(TripPlannerMapSnapshot(), isLoading = false).isEmpty)
    }
}
