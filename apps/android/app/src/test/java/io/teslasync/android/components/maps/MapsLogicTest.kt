package io.teslasync.android.components.maps

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free maps logic in `MapsLogic.kt` / `MapsModels.kt`.
 * These run in the `:android:testDebugUnitTest` gate and cover bounds fitting, grid
 * clustering, bearing/distance, the route-playback clock, geofence description, and the
 * accessible summaries — without the Google Maps Compose render layer.
 */
class MapsLogicTest {
    private val sf = GeoPoint(37.7749, -122.4194)
    private val oakland = GeoPoint(37.8044, -122.2712)
    private val nearSf = GeoPoint(37.7750, -122.4195)

    @Test
    fun geoPointValidityRejectsOutOfRangeAndNonFinite() {
        assertTrue(sf.isValid())
        assertFalse(GeoPoint(91.0, 0.0).isValid())
        assertFalse(GeoPoint(0.0, 200.0).isValid())
        assertFalse(GeoPoint(Double.NaN, 0.0).isValid())
    }

    @Test
    fun haversineMatchesKnownDistance() {
        // One degree of latitude is ~111.2 km.
        val d = haversineMeters(GeoPoint(0.0, 0.0), GeoPoint(1.0, 0.0))
        assertTrue("expected ~111195m but was $d", kotlin.math.abs(d - 111_195.0) < 500.0)
    }

    @Test
    fun headingPointsNorthAndEast() {
        assertEquals(0.0, headingBetween(GeoPoint(0.0, 0.0), GeoPoint(1.0, 0.0)), 1.0)
        assertEquals(90.0, headingBetween(GeoPoint(0.0, 0.0), GeoPoint(0.0, 1.0)), 1.0)
    }

    @Test
    fun boundsOfSpansValidPointsOnly() {
        assertNull(boundsOf(emptyList()))
        assertNull(boundsOf(listOf(GeoPoint(Double.NaN, 0.0))))
        val b = boundsOf(listOf(sf, oakland))!!
        assertEquals(37.7749, b.south, EPS)
        assertEquals(37.8044, b.north, EPS)
        assertTrue(b.contains(GeoPoint(37.79, -122.35)))
        assertEquals(37.78965, b.center.lat, 1e-4)
    }

    @Test
    fun padBoundsGrowsTheBox() {
        val b = MapBounds(south = 10.0, west = 10.0, north = 20.0, east = 20.0)
        val p = padBounds(b, 0.1)
        assertTrue(p.south < b.south && p.north > b.north)
        assertTrue(p.west < b.west && p.east > b.east)
    }

    @Test
    fun clusterCellShrinksAsZoomIncreases() {
        assertTrue(clusterCellDegrees(4.0, 60) > clusterCellDegrees(10.0, 60))
    }

    @Test
    fun clusterMarkersGroupsNearbyAndSeparatesFar() {
        val markers =
            listOf(
                MapMarker("a", sf),
                MapMarker("b", nearSf),
                MapMarker("c", oakland),
            )
        val clusters = clusterMarkers(markers, zoom = 10.0)
        assertEquals(2, clusters.size)
        val grouped = clusters.first { it.isCluster }
        assertEquals(2, grouped.count)
        assertTrue(grouped.memberIds.containsAll(listOf("a", "b")))
    }

    @Test
    fun clusterMarkersDisablesAboveThreshold() {
        val markers = listOf(MapMarker("a", sf), MapMarker("b", nearSf))
        val clusters = clusterMarkers(markers, zoom = 18.0, disableAtZoom = 16.0)
        assertEquals(2, clusters.size)
        assertTrue(clusters.all { it.count == 1 })
        assertTrue(clusterMarkers(emptyList(), 6.0).isEmpty())
    }

    @Test
    fun routeOffsetsAreRelativeToFirstSample() {
        val samples =
            listOf(
                RouteSample(sf, 1_000L),
                RouteSample(nearSf, 3_000L),
                RouteSample(oakland, 9_000L),
            )
        assertEquals(listOf(0L, 2_000L, 8_000L), routeOffsetsMs(samples))
        assertEquals(8_000L, playbackTotalMs(routeOffsetsMs(samples)))
    }

    @Test
    fun indexAtElapsedFindsNearestSample() {
        val offsets = listOf(0L, 2_000L, 8_000L)
        assertEquals(0, indexAtElapsed(offsets, 200L))
        assertEquals(1, indexAtElapsed(offsets, 2_400L))
        assertEquals(2, indexAtElapsed(offsets, 7_000L))
        assertEquals(0, indexAtElapsed(emptyList(), 5L))
    }

    @Test
    fun playbackPlayTickAndStopFlow() {
        val offsets = listOf(0L, 2_000L, 8_000L)
        var s = playbackPlay(PlaybackState(), offsets)
        assertTrue(s.playing)
        s = playbackSetSpeed(s, 10)
        assertEquals(10, s.speed)
        // 10x for 250ms = 2500ms elapsed -> nearest index 1.
        s = playbackTick(s, offsets, 250)
        assertEquals(2_500L, s.elapsedMs)
        assertEquals(1, s.index)
        // A huge tick runs past the end -> clamps + stops.
        s = playbackTick(s.copy(playing = true), offsets, 10_000)
        assertEquals(8_000L, s.elapsedMs)
        assertEquals(2, s.index)
        assertFalse(s.playing)
        // Play again from the end rewinds.
        s = playbackPlay(s, offsets)
        assertEquals(0L, s.elapsedMs)
        // Stop rewinds and pauses.
        s = playbackStop(s)
        assertEquals(0, s.index)
        assertFalse(s.playing)
    }

    @Test
    fun playbackSeekAndProgress() {
        val offsets = listOf(0L, 2_000L, 8_000L)
        val s = playbackSeek(PlaybackState(), offsets, 0.5f)
        assertEquals(4_000L, s.elapsedMs)
        assertEquals(0.5f, playbackProgress(s, offsets), 1e-4f)
        assertEquals(0f, playbackProgress(PlaybackState(elapsedMs = 5L), emptyList()), 0f)
    }

    @Test
    fun playbackGuardsTooFewSamples() {
        val single = listOf(0L)
        assertFalse(playbackPlay(PlaybackState(), single).playing)
        assertEquals(PlaybackState(), playbackTick(PlaybackState(), single, 100))
    }

    @Test
    fun normalizeSpeedClampsToSupported() {
        assertEquals(25, normalizePlaybackSpeed(25))
        assertEquals(1, normalizePlaybackSpeed(7))
    }

    @Test
    fun formatElapsedRendersMinutesAndHours() {
        assertEquals("00:05", formatElapsed(5_000L))
        assertEquals("02:03", formatElapsed(123_000L))
        assertEquals("1:01:01", formatElapsed(3_661_000L))
        assertEquals("00:00", formatElapsed(-10L))
    }

    @Test
    fun parseIsoTimestampHandlesValidAndInvalid() {
        assertEquals(0L, parseIsoTimestampMs("1970-01-01T00:00:00Z"))
        assertNull(parseIsoTimestampMs("not-a-date"))
    }

    @Test
    fun nextMapStyleCyclesThroughAll() {
        assertEquals(MapStyleId.Streets, nextMapStyle(MapStyleId.Dark))
        assertEquals(MapStyleId.Dark, nextMapStyle(MapStyleId.Terrain))
    }

    @Test
    fun markerAndClusterSummaries() {
        val markers = listOf(MapMarker("v1", sf, title = "Model 3", severity = MapMarkerSeverity.Critical))
        val lines = markerSummaryLines(markers)
        assertEquals(1, lines.size)
        assertTrue(lines[0].contains("Model 3"))
        assertTrue(lines[0].contains("critical"))
        val clusters = clusterSummaryLines(listOf(MarkerCluster(sf, 3, listOf("a", "b", "c"))))
        assertTrue(clusters[0].startsWith("3 markers"))
    }

    @Test
    fun routeSummaryDescribesCountDistanceDuration() {
        val samples = listOf(RouteSample(sf, 0L), RouteSample(oakland, 600_000L))
        val line = routeSummaryLine(samples)
        assertTrue(line.contains("2 points"))
        assertTrue(line.contains("km"))
        assertEquals("Route with no GPS points.", routeSummaryLine(emptyList()))
    }

    @Test
    fun geofenceShapeAndDescription() {
        val circle = MapGeofence("g1", name = "Home", center = sf, radiusMeters = 150.0)
        assertEquals(GeofenceShape.Circle, circle.shape())
        assertTrue(describeGeofence(circle).contains("150m circle"))
        val rect =
            MapGeofence(
                "g2",
                polygon = listOf(GeoPoint(1.0, 1.0), GeoPoint(1.0, 2.0), GeoPoint(2.0, 2.0), GeoPoint(2.0, 1.0)),
            )
        assertEquals(GeofenceShape.Rectangle, rect.shape())
        val poly =
            MapGeofence("g3", polygon = listOf(GeoPoint(0.0, 0.0), GeoPoint(0.0, 1.0), GeoPoint(1.0, 0.5)))
        assertEquals(GeofenceShape.Polygon, poly.shape())
        assertEquals(3, geofenceSummaryLines(listOf(circle, rect, poly)).size)
    }

    @Test
    fun lerpDoubleInterpolatesAndClamps() {
        assertEquals(5.0, lerpDouble(0.0, 10.0, 0.5f), EPS)
        assertEquals(10.0, lerpDouble(0.0, 10.0, 2f), EPS)
        assertEquals(0.0, lerpDouble(0.0, 10.0, -1f), EPS)
    }

    @Test
    fun rectangleRingSpansCornersAxisAligned() {
        val ring = rectangleRing(GeoPoint(2.0, 5.0), GeoPoint(1.0, 4.0))
        assertEquals(4, ring.size)
        assertEquals(GeoPoint(1.0, 4.0), ring.first())
        assertEquals(2.0, ring[3].lat, EPS)
        assertEquals(GeofenceShape.Rectangle, MapGeofence("r", polygon = ring).shape())
    }

    @Test
    fun draftGeofenceBuildsWhenComplete() {
        assertNull(draftGeofence(GeofenceShape.Circle, center = null, radiusMeters = 100.0, vertices = emptyList()))
        val circle = draftGeofence(GeofenceShape.Circle, center = sf, radiusMeters = 100.0, vertices = emptyList())
        assertEquals(GeofenceShape.Circle, circle?.shape)
        val twoVerts = listOf(GeoPoint(0.0, 0.0), GeoPoint(1.0, 1.0))
        assertNull(draftGeofence(GeofenceShape.Polygon, center = null, radiusMeters = 0.0, vertices = twoVerts))
        val tri = twoVerts + GeoPoint(2.0, 0.0)
        assertEquals(GeofenceShape.Polygon, draftGeofence(GeofenceShape.Polygon, null, 0.0, tri)?.shape)
        val ring = rectangleRing(GeoPoint(0.0, 0.0), GeoPoint(1.0, 1.0))
        assertEquals(GeofenceShape.Rectangle, draftGeofence(GeofenceShape.Rectangle, null, 0.0, ring)?.shape)
    }

    @Test
    fun mapStyleJsonEmbedsTokenColors() {
        val colors = MapStyleColors("#0B1020", "#13233A", "#1E2A3A", "#9FB3C8", "#0B1020")
        val json = darkMapStyleJson(colors)
        assertTrue(json.contains("#13233A"))
        assertTrue(json.contains("water"))
        assertEquals("#FF8800", colorToHex(Color(0xFFFF8800)))
    }

    companion object {
        private const val EPS = 1e-6
    }
}
