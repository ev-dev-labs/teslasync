package io.teslasync.android.featureviews.tripreplaymap

import io.teslasync.android.components.maps.GeoPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TripReplayMap's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/trips/components/TripReplayMap.tsx + the @/lib/geo helpers it imports): the
 * `(0,0)`-rejecting coordinate validity, the stationary-route detection + anchor, the verbatim `speedColor` band
 * ladder + segment grouping, the heading-aware playhead, the nearest-sample seek scan, the centre fallback, and
 * the start/end/stationary accessible summary. Because the surface is presentational, each projected value is
 * exactly what the thin composable renders.
 */
class TripReplayMapProjectionTest {
    private fun strings(): TripReplayMapStrings =
        TripReplayMapStrings(
            routeLabel = "Trip Replay",
            start = "Start",
            end = "End",
            stationaryTitle = "Route can't be plotted",
            stationaryBody = "Only one GPS coordinate was recorded for this drive.",
            noPositions = "No position data available for this drive",
        )

    /** A four-point moving route. Segments are coloured by the LATER point's speed (web `curr`), so the per-pair
     *  bands are p1=5 Low | p2=40 Moderate | p3=70 Fast — three distinct two-point runs. */
    private fun movingRoute(): TripReplayMapSnapshot =
        TripReplayMapSnapshot(
            positions =
                listOf(
                    ReplayPosition(47.610, -122.330, 0.0),
                    ReplayPosition(47.612, -122.333, 5.0),
                    ReplayPosition(47.615, -122.338, 40.0),
                    ReplayPosition(47.620, -122.345, 70.0),
                ),
        )

    /** A stationary capture: every recorded coordinate sits within a few centimetres of the first. */
    private fun stationaryRoute(): TripReplayMapSnapshot =
        TripReplayMapSnapshot(
            positions =
                listOf(
                    ReplayPosition(47.610, -122.330, 0.0),
                    ReplayPosition(47.6100001, -122.3300001, 0.0),
                ),
        )

    // ── isValidLatLng: the (0,0)-rejecting validity ──────────────────────────────

    @Test
    fun isValidLatLngRejectsTheGpsNotFixedSentinelAndOutOfBounds() {
        assertTrue(TripReplayMapProjection.isValidLatLng(47.6, -122.3))
        assertTrue(TripReplayMapProjection.isValidLatLng(0.0, 1.0))
        assertFalse(TripReplayMapProjection.isValidLatLng(0.0, 0.0))
        assertFalse(TripReplayMapProjection.isValidLatLng(Double.NaN, 1.0))
        assertFalse(TripReplayMapProjection.isValidLatLng(91.0, 0.0))
        assertFalse(TripReplayMapProjection.isValidLatLng(0.0, 181.0))
    }

    // ── hasMeaningfulRoute + firstValidIndex/anchor ──────────────────────────────

    @Test
    fun hasMeaningfulRouteIsTrueOnlyWhenTwoValidPointsExceedTenMetres() {
        assertTrue(TripReplayMapProjection.hasMeaningfulRoute(movingRoute().positions))
        assertFalse(TripReplayMapProjection.hasMeaningfulRoute(stationaryRoute().positions))
        assertFalse(TripReplayMapProjection.hasMeaningfulRoute(listOf(ReplayPosition(47.610, -122.330, 0.0))))
        assertFalse(TripReplayMapProjection.hasMeaningfulRoute(emptyList()))
    }

    @Test
    fun firstValidIndexSkipsTheZeroZeroSentinelAndAnchorsThere() {
        val positions = listOf(ReplayPosition(0.0, 0.0), ReplayPosition(47.61, -122.33))
        assertEquals(1, TripReplayMapProjection.firstValidIndex(positions))
        assertEquals(GeoPoint(47.61, -122.33), TripReplayMapProjection.anchorPointOf(positions))
        assertNull(TripReplayMapProjection.anchorPointOf(listOf(ReplayPosition(0.0, 0.0))))
    }

    // ── bandFor: the verbatim web speedColor ladder (raw SI vs literal 30/60/100) ─

    @Test
    fun bandForFollowsTheWebSpeedColorLadder() {
        assertEquals(SpeedBand.Low, TripReplayMapProjection.bandFor(null))
        assertEquals(SpeedBand.Low, TripReplayMapProjection.bandFor(0.0))
        assertEquals(SpeedBand.Low, TripReplayMapProjection.bandFor(SPEED_BAND_LOW - 0.001))
        assertEquals(SpeedBand.Moderate, TripReplayMapProjection.bandFor(SPEED_BAND_LOW))
        assertEquals(SpeedBand.Moderate, TripReplayMapProjection.bandFor(SPEED_BAND_MED - 0.001))
        assertEquals(SpeedBand.Fast, TripReplayMapProjection.bandFor(SPEED_BAND_MED))
        assertEquals(SpeedBand.Fast, TripReplayMapProjection.bandFor(SPEED_BAND_HIGH - 0.001))
        assertEquals(SpeedBand.VeryFast, TripReplayMapProjection.bandFor(SPEED_BAND_HIGH))
        assertEquals(SpeedBand.VeryFast, TripReplayMapProjection.bandFor(150.0))
    }

    // ── speedSegments: per-pair colour merged into equal-band runs ───────────────

    @Test
    fun speedSegmentsMergeConsecutiveEqualBandPairsIntoRuns() {
        // p1=5 (Low) | p2=40 (Moderate) | p3=70, p4=70 (Fast — the last two pairs merge into one run).
        val positions =
            listOf(
                ReplayPosition(47.610, -122.330, 0.0),
                ReplayPosition(47.612, -122.333, 5.0),
                ReplayPosition(47.615, -122.338, 40.0),
                ReplayPosition(47.618, -122.342, 70.0),
                ReplayPosition(47.620, -122.345, 70.0),
            )
        val segments = TripReplayMapProjection.speedSegments(positions)
        assertEquals(3, segments.size)
        assertEquals(SpeedBand.Low, segments[0].band)
        assertEquals(2, segments[0].points.size)
        assertEquals(SpeedBand.Moderate, segments[1].band)
        assertEquals(2, segments[1].points.size)
        assertEquals(SpeedBand.Fast, segments[2].band)
        assertEquals(3, segments[2].points.size)
    }

    @Test
    fun speedSegmentsAreEmptyForFewerThanTwoPoints() {
        assertTrue(TripReplayMapProjection.speedSegments(emptyList()).isEmpty())
        assertTrue(TripReplayMapProjection.speedSegments(listOf(ReplayPosition(1.0, 2.0, 9.0))).isEmpty())
    }

    // ── nearestSampleIndex: the seek scan ────────────────────────────────────────

    @Test
    fun nearestSampleIndexReturnsTheClosestSampleAndZeroWhenEmpty() {
        val positions = movingRoute().positions
        // A tap right on the third sample resolves to index 2.
        assertEquals(2, TripReplayMapProjection.nearestSampleIndex(positions, 47.615, -122.338))
        // A tap nearest the last sample resolves to the final index.
        assertEquals(3, TripReplayMapProjection.nearestSampleIndex(positions, 47.621, -122.346))
        assertEquals(0, TripReplayMapProjection.nearestSampleIndex(emptyList(), 1.0, 2.0))
    }

    // ── computeHeading + headingForIndex: the playhead bearing ───────────────────

    @Test
    fun computeHeadingPointsEastForAnEastwardSegment() {
        val heading = TripReplayMapProjection.computeHeading(ReplayPosition(0.0, 0.0), ReplayPosition(0.0, 1.0))
        assertEquals(90.0, heading, 1e-6)
    }

    @Test
    fun headingForIndexIsZeroForStationaryOrTooFewSamplesAndGuardsOutOfRange() {
        assertEquals(0.0, TripReplayMapProjection.headingForIndex(movingRoute().positions, 0, hasRoute = false), 0.0)
        assertEquals(
            0.0,
            TripReplayMapProjection.headingForIndex(listOf(ReplayPosition(1.0, 1.0, 0.0)), 0, hasRoute = true),
            0.0,
        )
        // An out-of-range cursor never throws / returns NaN.
        assertEquals(0.0, TripReplayMapProjection.headingForIndex(movingRoute().positions, 99, hasRoute = true), 0.0)
        // A valid cursor on a real route yields a finite bearing in [0, 360).
        val heading = TripReplayMapProjection.headingForIndex(movingRoute().positions, 0, hasRoute = true)
        assertTrue(heading.isFinite() && heading >= 0.0 && heading < 360.0)
    }

    // ── currentPoint: the playhead position gate ─────────────────────────────────

    @Test
    fun currentPointTracksTheCursorOnlyForAMeaningfulRouteInRange() {
        val positions = movingRoute().positions
        assertEquals(GeoPoint(47.615, -122.338), TripReplayMapProjection.currentPoint(positions, 2, hasRoute = true))
        assertNull(TripReplayMapProjection.currentPoint(positions, 2, hasRoute = false))
        assertNull(TripReplayMapProjection.currentPoint(positions, 99, hasRoute = true))
    }

    // ── centerOf: the web centerPos fallback chain ───────────────────────────────

    @Test
    fun centerOfPrefersTheStartThenTheAnchorThenTheFallback() {
        val start = GeoPoint(1.0, 2.0)
        val anchor = GeoPoint(3.0, 4.0)
        assertEquals(start, TripReplayMapProjection.centerOf(start, anchor))
        assertEquals(anchor, TripReplayMapProjection.centerOf(null, anchor))
        assertEquals(GeoPoint(FALLBACK_CENTER_LAT, FALLBACK_CENTER_LNG), TripReplayMapProjection.centerOf(null, null))
    }

    // ── project: the assembled content display ───────────────────────────────────

    @Test
    fun projectAssemblesTheMeaningfulRouteContent() {
        val display = TripReplayMapProjection.project(movingRoute(), strings())
        assertTrue(display.hasPositions)
        assertTrue(display.hasRoute)
        assertEquals(4, display.trail.size)
        assertEquals(3, display.segments.size)
        assertEquals(display.trail.first(), display.startPos)
        assertEquals(display.trail.last(), display.endPos)
        assertNull(display.anchorPoint)
        assertEquals(REPLAY_INITIAL_ZOOM, display.zoom)
        // The map centre is the first trail point (web `startPos`).
        assertEquals(47.610, display.center.lat, 1e-9)
        assertEquals(2, display.summaryLines.size)
        assertTrue(display.summaryLines[0].startsWith("Start"))
        assertTrue(display.summaryLines[1].startsWith("End"))
    }

    @Test
    fun projectSurfacesTheStationaryAnchorAndBanner() {
        val display = TripReplayMapProjection.project(stationaryRoute(), strings())
        assertTrue(display.hasPositions)
        assertFalse(display.hasRoute)
        assertTrue(display.trail.isEmpty())
        assertTrue(display.segments.isEmpty())
        assertNull(display.startPos)
        assertNull(display.endPos)
        assertEquals(47.610, display.anchorPoint?.lat ?: 0.0, 1e-9)
        // The stationary summary lists the recorded location + the explanatory banner.
        assertEquals(2, display.summaryLines.size)
        assertTrue(display.summaryLines[0].startsWith("Trip Replay"))
        assertTrue(display.summaryLines[1].startsWith("Route can't be plotted"))
    }

    @Test
    fun projectEmptyPositionsHasNoSummary() {
        val display = TripReplayMapProjection.project(TripReplayMapSnapshot(), strings())
        assertFalse(display.hasPositions)
        assertFalse(display.hasRoute)
        assertTrue(display.trail.isEmpty())
        assertTrue(display.summaryLines.isEmpty())
        // The centre falls back to the web `[47.6, -122.3]` default.
        assertEquals(FALLBACK_CENTER_LAT, display.center.lat, 0.0)
        assertEquals(FALLBACK_CENTER_LNG, display.center.lng, 0.0)
    }

    // ── projectUiState: the cache-then-network surface mapping ───────────────────

    @Test
    fun projectUiStateMapsLoadingContentAndEmpty() {
        assertTrue(TripReplayMapProjection.projectUiState(null, isLoading = true).isLoading)
        assertTrue(TripReplayMapProjection.projectUiState(movingRoute(), isLoading = false).isContent)
        assertTrue(TripReplayMapProjection.projectUiState(null, isLoading = false).isEmpty)
        assertTrue(TripReplayMapProjection.projectUiState(TripReplayMapSnapshot(), isLoading = false).isEmpty)
    }
}
