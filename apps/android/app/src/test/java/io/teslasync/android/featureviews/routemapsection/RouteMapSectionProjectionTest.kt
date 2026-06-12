package io.teslasync.android.featureviews.routemapsection

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.shared.core.units.SpeedUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the RouteMapSection's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/drive-detail/RouteMapSection.tsx + the @/lib/geo
 * helpers and the useDriveDetailData route/segment maths): the `(0,0)`-rejecting coordinate validity, the
 * stationary-route detection, the speed-band ladder + segment grouping, the centre fallback, the SI -> display
 * legend conversion, and the start/end/stationary accessible summary. Every formatter is pinned to [Locale.US] +
 * UTC so the assertions are deterministic; because the surface is presentational, each projected value is
 * exactly what the thin composable renders.
 */
class RouteMapSectionProjectionTest {
    private val zone = ZoneOffset.UTC
    private val mphPrefs = RouteMapDisplayPrefs(SpeedUnitPref.MPH, 0, Locale.US)
    private val kmhPrefs = RouteMapDisplayPrefs.DEFAULT

    private fun strings(): RouteMapStrings =
        RouteMapStrings(
            route = "Route",
            start = "Start",
            end = "End",
            inProgress = "In progress",
            lastKnown = "Last known location",
            stationaryTitle = "Route can't be plotted",
            stationaryBody = "Only one GPS coordinate was recorded for this drive.",
            noRouteData = "No route data available for this drive",
        )

    /** A five-point moving route. Segments are coloured by the LATER point's speed (web `curr`), so the
     * per-pair bands are: p1=5 Low | p2=20 Moderate | p3=50, p4=50 VeryFast (the last two merge). */
    private fun movingRoute(endTs: String? = "2026-03-14T09:42:00Z"): RouteMapSnapshot =
        RouteMapSnapshot(
            routePoints =
                listOf(
                    RouteMapPoint(47.610, -122.330, 0.0),
                    RouteMapPoint(47.612, -122.333, 5.0),
                    RouteMapPoint(47.615, -122.338, 20.0),
                    RouteMapPoint(47.618, -122.342, 50.0),
                    RouteMapPoint(47.620, -122.345, 50.0),
                ),
            positions = listOf(RouteMapLatLng(47.610, -122.330), RouteMapLatLng(47.620, -122.345)),
            startTs = "2026-03-14T09:15:00Z",
            endTs = endTs,
            startLat = 47.610,
            startLon = -122.330,
        )

    /** A stationary capture: a route source that never moves and clustered raw positions. */
    private fun stationaryRoute(): RouteMapSnapshot =
        RouteMapSnapshot(
            routePoints = listOf(RouteMapPoint(47.610, -122.330, 0.0), RouteMapPoint(47.610, -122.330, 0.0)),
            positions = listOf(RouteMapLatLng(47.610, -122.330), RouteMapLatLng(47.6100001, -122.3300001)),
            startTs = "2026-03-14T09:15:00Z",
            endTs = null,
            startLat = 47.610,
            startLon = -122.330,
        )

    // ── isValidLatLng: the (0,0)-rejecting validity ──────────────────────────────

    @Test
    fun isValidLatLngRejectsTheGpsNotFixedSentinelAndOutOfBounds() {
        assertTrue(RouteMapProjection.isValidLatLng(47.6, -122.3))
        assertTrue(RouteMapProjection.isValidLatLng(0.0, 1.0))
        assertFalse(RouteMapProjection.isValidLatLng(0.0, 0.0))
        assertFalse(RouteMapProjection.isValidLatLng(Double.NaN, 1.0))
        assertFalse(RouteMapProjection.isValidLatLng(91.0, 0.0))
        assertFalse(RouteMapProjection.isValidLatLng(0.0, 181.0))
    }

    // ── hasMeaningfulRoute + firstValidIndex/anchor ──────────────────────────────

    @Test
    fun hasMeaningfulRouteIsTrueOnlyWhenTwoValidPointsExceedTenMetres() {
        val moving = listOf(RouteMapLatLng(47.610, -122.330), RouteMapLatLng(47.620, -122.345))
        assertTrue(RouteMapProjection.hasMeaningfulRoute(moving))

        val clustered = listOf(RouteMapLatLng(47.610, -122.330), RouteMapLatLng(47.6100001, -122.3300001))
        assertFalse(RouteMapProjection.hasMeaningfulRoute(clustered))

        assertFalse(RouteMapProjection.hasMeaningfulRoute(listOf(RouteMapLatLng(47.610, -122.330))))
        assertFalse(RouteMapProjection.hasMeaningfulRoute(emptyList()))
    }

    @Test
    fun firstValidIndexSkipsTheZeroZeroSentinelAndAnchorsThere() {
        val positions = listOf(RouteMapLatLng(0.0, 0.0), RouteMapLatLng(47.61, -122.33))
        assertEquals(1, RouteMapProjection.firstValidIndex(positions))
        assertEquals(GeoPoint(47.61, -122.33), RouteMapProjection.anchorPointOf(positions))
        assertNull(RouteMapProjection.anchorPointOf(listOf(RouteMapLatLng(0.0, 0.0))))
    }

    // ── bandFor: the verbatim web speed ladder ───────────────────────────────────

    @Test
    fun bandForFollowsTheWebThresholdLadder() {
        assertEquals(SpeedBand.Low, RouteMapProjection.bandFor(0.0))
        assertEquals(SpeedBand.Low, RouteMapProjection.bandFor(SPEED_SEGMENT_LOW_MPS - 0.001))
        assertEquals(SpeedBand.Moderate, RouteMapProjection.bandFor(SPEED_SEGMENT_LOW_MPS))
        assertEquals(SpeedBand.Moderate, RouteMapProjection.bandFor(SPEED_SEGMENT_MED_MPS - 0.001))
        assertEquals(SpeedBand.Fast, RouteMapProjection.bandFor(SPEED_SEGMENT_MED_MPS))
        assertEquals(SpeedBand.Fast, RouteMapProjection.bandFor(SPEED_SEGMENT_HIGH_MPS - 0.001))
        assertEquals(SpeedBand.VeryFast, RouteMapProjection.bandFor(SPEED_SEGMENT_HIGH_MPS))
        assertEquals(SpeedBand.VeryFast, RouteMapProjection.bandFor(100.0))
    }

    // ── speedSegments: per-pair colour merged into equal-band runs ───────────────

    @Test
    fun speedSegmentsMergeConsecutiveEqualBandPairsIntoRuns() {
        val segments = RouteMapProjection.speedSegments(movingRoute().routePoints)
        // p1=5 (Low) | p2=20 (Moderate) | p3=50, p4=50 (VeryFast, merged)
        assertEquals(3, segments.size)
        assertEquals(SpeedBand.Low, segments[0].band)
        assertEquals(2, segments[0].points.size)
        assertEquals(SpeedBand.Moderate, segments[1].band)
        assertEquals(2, segments[1].points.size)
        assertEquals(SpeedBand.VeryFast, segments[2].band)
        assertEquals(3, segments[2].points.size)
    }

    @Test
    fun speedSegmentsAreEmptyForFewerThanTwoPoints() {
        assertTrue(RouteMapProjection.speedSegments(emptyList()).isEmpty())
        assertTrue(RouteMapProjection.speedSegments(listOf(RouteMapPoint(1.0, 2.0, 9.0))).isEmpty())
    }

    // ── centerOf: the web centerPos fallback chain ───────────────────────────────

    @Test
    fun centerOfPrefersTheTrailStartThenTheDriveStartThenTheFallback() {
        val start = GeoPoint(1.0, 2.0)
        assertEquals(start, RouteMapProjection.centerOf(start, 9.0, 9.0))

        val fromDrive = RouteMapProjection.centerOf(null, 47.6, -122.3)
        assertEquals(47.6, fromDrive.lat, 0.0)
        assertEquals(-122.3, fromDrive.lng, 0.0)

        // A zero component is falsy in the web `startLat && startLon`, so it falls through to the fallback.
        val fallback = RouteMapProjection.centerOf(null, 0.0, -122.3)
        assertEquals(FALLBACK_CENTER_LAT, fallback.lat, 0.0)
        assertEquals(FALLBACK_CENTER_LNG, fallback.lng, 0.0)
        assertEquals(FALLBACK_CENTER_LAT, RouteMapProjection.centerOf(null, null, null).lat, 0.0)
    }

    // ── legend: SI -> display conversion + range labels ──────────────────────────

    @Test
    fun legendConvertsThresholdsToMphAtZeroPrecision() {
        val legend = RouteMapProjection.legend(mphPrefs)
        assertEquals(4, legend.size)
        assertEquals(SpeedBand.Low, legend[0].band)
        assertEquals("<30", legend[0].range)
        assertEquals("30\u201360", legend[1].range)
        assertEquals("60\u2013100", legend[2].range)
        assertEquals(">100", legend[3].range)
        assertEquals(SpeedBand.VeryFast, legend[3].band)
    }

    @Test
    fun legendConvertsThresholdsToKmhAtTwoPrecision() {
        val legend = RouteMapProjection.legend(kmhPrefs)
        assertEquals("<48.28", legend[0].range)
        assertEquals("48.28\u201396.56", legend[1].range)
        assertEquals("96.56\u2013160.93", legend[2].range)
        assertEquals(">160.93", legend[3].range)
    }

    // ── fmtNumber: Intl.NumberFormat parity ──────────────────────────────────────

    @Test
    fun fmtNumberGroupsAndRoundsHalfAwayFromZero() {
        assertEquals("1,234.5", RouteMapProjection.fmtNumber(1_234.45, 1, Locale.US))
        assertEquals("46", RouteMapProjection.fmtNumber(45.5, 0, Locale.US))
        assertEquals("0", RouteMapProjection.fmtNumber(Double.NaN, 0, Locale.US))
    }

    // ── time formatters: valid render + em-dash guard ────────────────────────────

    @Test
    fun timeFormattersRenderValidInstantsAndDashTheRest() {
        assertTrue(RouteMapProjection.formatClockTime("2026-03-14T09:15:00Z", Locale.US, zone).any { it.isDigit() })
        assertTrue(RouteMapProjection.formatDateTime("2026-03-14T09:15:00Z", Locale.US, zone).contains("2026"))
        assertEquals(ROUTE_MAP_EM_DASH, RouteMapProjection.formatClockTime("", Locale.US, zone))
        assertEquals(ROUTE_MAP_EM_DASH, RouteMapProjection.formatDateTime("not-a-date", Locale.US, zone))
    }

    // ── project: the assembled content display ───────────────────────────────────

    @Test
    fun projectAssemblesTheMeaningfulRouteContent() {
        val display = RouteMapProjection.project(movingRoute(), mphPrefs, strings(), zone)
        assertTrue(display.hasTrail)
        assertTrue(display.hasRoute)
        assertFalse(display.inProgress)
        assertEquals(5, display.trail.size)
        assertEquals(3, display.segments.size)
        assertEquals(display.trail.first(), display.startPos)
        assertEquals(display.trail.last(), display.endPos)
        assertNull(display.anchorPoint)
        assertTrue(display.showLegend)
        assertEquals("mph", display.speedUnitLabel)
        assertTrue(display.endPopupText.contains("2026"))
        assertEquals(2, display.summaryLines.size)
        assertTrue(display.summaryLines[0].startsWith("Start"))
        assertTrue(display.summaryLines[1].startsWith("End"))
        // The map centre is the first trail point (web `startPos`).
        assertEquals(47.610, display.center.lat, 1e-9)
    }

    @Test
    fun projectSurfacesTheStationaryAnchorAndBanner() {
        val display = RouteMapProjection.project(stationaryRoute(), mphPrefs, strings(), zone)
        assertTrue(display.hasTrail)
        assertFalse(display.hasRoute)
        assertTrue(display.segments.isEmpty())
        assertNull(display.startPos)
        assertNull(display.endPos)
        assertEquals(47.610, display.anchorPoint?.lat ?: 0.0, 1e-9)
        assertFalse(display.showLegend)
        // The stationary summary lists the last-known label and the explanatory banner.
        assertEquals("Last known location", display.summaryLines[0])
        assertTrue(display.summaryLines[1].startsWith("Route can't be plotted"))
    }

    @Test
    fun projectMarksAnInProgressDriveAndDropsTheEndTime() {
        val display = RouteMapProjection.project(movingRoute(endTs = null), mphPrefs, strings(), zone)
        assertTrue(display.inProgress)
        assertEquals("In progress", display.endPopupText)
        assertNull(display.endTimeText)
        assertTrue(display.startTimeText.any { it.isDigit() })
    }

    // ── projectUiState: the cache-then-network surface mapping ───────────────────

    @Test
    fun projectUiStateMapsLoadingContentAndEmpty() {
        assertTrue(RouteMapProjection.projectUiState(null, isLoading = true).isLoading)
        assertTrue(RouteMapProjection.projectUiState(movingRoute(), isLoading = false).isContent)
        assertTrue(RouteMapProjection.projectUiState(null, isLoading = false).isEmpty)
        val noPoints = movingRoute().copy(routePoints = emptyList())
        assertTrue(RouteMapProjection.projectUiState(noPoints, isLoading = false).isEmpty)
    }
}
