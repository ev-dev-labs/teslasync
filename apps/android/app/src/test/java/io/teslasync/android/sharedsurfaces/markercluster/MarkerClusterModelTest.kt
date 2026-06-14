package io.teslasync.android.sharedsurfaces.markercluster

import io.teslasync.android.components.maps.MapMarkerSeverity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the MarkerCluster's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/maps/MarkerCluster.tsx + its `MarkerCluster.test.tsx` vectors): the
 * 5000-point cap (applied before filtering), the finite-coordinate skip, the point→marker mapping (the
 * `ariaLabel`→title / `popupHtml`→snippet / `color`→severity carry), the reverse index a tap uses to forward
 * the ORIGINAL point, and the bounded accessible-summary digest. Because the composable is a thin render layer
 * over [projectMarkerCluster], the per-branch assertions here double as the surface's per-state snapshot. Runs
 * in the :android:testReleaseUnitTest gate.
 */
class MarkerClusterModelTest {
    // ── Empty state (web: an empty `points` array registers a group with no markers) ──────────────────────

    @Test
    fun anEmptyPointListProjectsToTheEmptyState() {
        val projection = projectMarkerCluster(emptyList())

        assertTrue(projection.isEmpty)
        assertEquals(0, projection.renderedCount)
        assertEquals(0, projection.suppliedCount)
        assertTrue(projection.markers.isEmpty())
        assertTrue(projection.pointsById.isEmpty())
    }

    // ── Populated state: each finite point becomes one marker carrying its label / popup / colour ──────────

    @Test
    fun mapsEachFinitePointToAMarkerCarryingItsLabelPopupAndColour() {
        val points =
            listOf(
                ClusterPoint(id = "a", lat = 1.0, lng = 2.0, ariaLabel = "Home", popupText = "Home charger"),
                ClusterPoint(id = "b", lat = 3.0, lng = 4.0, severity = MapMarkerSeverity.Warning),
            )

        val projection = projectMarkerCluster(points)

        assertFalse(projection.isEmpty)
        assertEquals(2, projection.renderedCount)
        val first = projection.markers.first()
        assertEquals("a", first.id)
        assertEquals(1.0, first.point.lat, 0.0)
        assertEquals(2.0, first.point.lng, 0.0)
        assertEquals("Home", first.title)
        assertEquals("Home charger", first.snippet)
        // No per-point colour ⇒ the surface default severity.
        assertEquals(MapMarkerSeverity.Active, first.severity)
        // A per-point colour overrides the default (web per-point `color`).
        assertEquals(MapMarkerSeverity.Warning, projection.markers[1].severity)
    }

    @Test
    fun honoursACustomDefaultSeverityWhenAPointHasNoOverride() {
        val projection =
            projectMarkerCluster(
                listOf(ClusterPoint(id = "a", lat = 1.0, lng = 2.0)),
                defaultSeverity = MapMarkerSeverity.Success,
            )

        assertEquals(MapMarkerSeverity.Success, projection.markers.single().severity)
    }

    // ── Skips non-finite coordinates (web "skips points with NaN coordinates") ────────────────────────────

    @Test
    fun skipsPointsWithNonFiniteCoordinates() {
        val points =
            listOf(
                ClusterPoint(id = "good", lat = 1.0, lng = 2.0),
                ClusterPoint(id = "nan", lat = Double.NaN, lng = 4.0),
                ClusterPoint(id = "inf", lat = 5.0, lng = Double.POSITIVE_INFINITY),
                ClusterPoint(id = "offEnvelope", lat = 200.0, lng = 4.0),
            )

        val projection = projectMarkerCluster(points)

        assertEquals(1, projection.renderedCount)
        assertEquals("good", projection.markers.single().id)
        assertEquals(3, projection.skippedInvalidCount)
        assertEquals(4, projection.suppliedCount)
    }

    // ── Caps the rendered set at 5000, applied to the RAW list first (web `slice(0, 5000)`) ───────────────

    @Test
    fun capsRenderedMarkersAtFiveThousand() {
        val points = (0 until 6_000).map { i -> ClusterPoint(id = "p$i", lat = i * 0.0001, lng = i * 0.0001) }

        val projection = projectMarkerCluster(points)

        assertEquals(MAX_RENDERED_POINTS, projection.renderedCount)
        assertEquals(6_000, projection.suppliedCount)
        assertEquals(1_000, projection.cappedOverflowCount)
    }

    @Test
    fun theCapIsAppliedBeforeTheCoordinateFilter() {
        // The first 5000 are valid; everything past the cap is dropped before validity is ever considered,
        // so an invalid point at index 5500 contributes to neither the rendered set nor the skipped count.
        val points =
            (0 until 5_000).map { i -> ClusterPoint(id = "ok$i", lat = 0.001 * i % 80, lng = 0.001 * i % 170) } +
                ClusterPoint(id = "lateNaN", lat = Double.NaN, lng = Double.NaN)

        val projection = projectMarkerCluster(points)

        assertEquals(MAX_RENDERED_POINTS, projection.renderedCount)
        assertEquals(0, projection.skippedInvalidCount)
        assertEquals(1, projection.cappedOverflowCount)
    }

    // ── Reverse index: a tap recovers the ORIGINAL point (web `onMarkerClick(point)`) ─────────────────────

    @Test
    fun retainsAReverseIndexFromMarkerIdToTheOriginalPoint() {
        val original = ClusterPoint(id = "p1", lat = 10.0, lng = 20.0, ariaLabel = "Pier 70", popupText = "<b>hi</b>")

        val projection = projectMarkerCluster(listOf(original))

        assertEquals(original, projection.pointsById[projection.markers.single().id])
    }

    // ── Accessible summary: one line per marker (ariaLabel or coordinate), bounded + locale-stable ─────────

    @Test
    fun summaryUsesTheAriaLabelWhenPresentAndFallsBackToACoordinate() {
        val projection =
            projectMarkerCluster(
                listOf(
                    ClusterPoint(id = "a", lat = 47.61, lng = -122.33, ariaLabel = "Downtown"),
                    ClusterPoint(id = "b", lat = 47.62, lng = -122.35),
                ),
            )

        val lines = markerClusterSummaryLines(projection)

        assertEquals("Downtown", lines[0])
        assertEquals("47.6200, -122.3500", lines[1])
    }

    @Test
    fun summaryCoordinateFallbackUsesADotDecimalRegardlessOfDeviceLocale() {
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.GERMANY)
            val projection = projectMarkerCluster(listOf(ClusterPoint(id = "a", lat = 47.61, lng = -122.33)))
            assertEquals("47.6100, -122.3300", markerClusterSummaryLines(projection).single())
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test
    fun summaryIsBoundedToTheMaximumLineCount() {
        val points = (0 until MAX_SUMMARY_LINES + 50).map { i -> ClusterPoint(id = "p$i", lat = 1.0, lng = 1.0 + i * 0.001) }

        val lines = markerClusterSummaryLines(projectMarkerCluster(points))

        assertEquals(MAX_SUMMARY_LINES, lines.size)
    }

    @Test
    fun blankAriaLabelFallsBackToTheCoordinate() {
        val projection = projectMarkerCluster(listOf(ClusterPoint(id = "a", lat = 1.0, lng = 2.0, ariaLabel = "   ")))

        assertEquals("1.0000, 2.0000", markerClusterSummaryLines(projection).single())
        assertNull(projection.markers.single().title)
    }
}
