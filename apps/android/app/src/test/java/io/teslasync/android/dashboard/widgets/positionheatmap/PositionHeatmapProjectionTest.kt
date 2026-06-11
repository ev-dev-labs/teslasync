package io.teslasync.android.dashboard.widgets.positionheatmap

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the PositionHeatmapWidget's pure logic — the grid-based
 * `clusterPositions` density buckets, the `centroid` map center, the `intensityColor` cool→hot ramp,
 * the per-footprint circle radius / fill-opacity, the `isEmpty` gate, the registry metadata, and the
 * `/positions` JSON decode + cache-then-network `Resource` mapper. Mirrors the web spec
 * (web/src/features/dashboard/widgets/PositionHeatmapWidget.tsx) verbatim, including the `0,0`-skip
 * (excluded from clusters but counted in the badge total) and the coordinates-are-not-converted rule.
 */
class PositionHeatmapProjectionTest {
    private fun strings(): PositionHeatmapStrings =
        PositionHeatmapStrings(
            title = "Position Heatmap",
            noData = "No position data",
            countLabel = { count -> "$count positions" },
        )

    // Three readings in one 500-grid bucket + one reading in another → counts 3 and 1.
    private fun twoBucketPositions(): List<HeatPosition> =
        listOf(
            HeatPosition(10.0, 20.0),
            HeatPosition(10.0, 20.0),
            HeatPosition(10.0, 20.0),
            HeatPosition(40.0, 50.0),
        )

    // ---- clusterPositions ----------------------------------------------------------

    @Test
    fun clusterPositionsBucketsByGridAndNormalisesIntensity() {
        val clusters = PositionHeatmapProjection.clusterPositions(twoBucketPositions(), PositionHeatmapProjection.STANDARD_PRECISION)
        assertEquals(2, clusters.size)
        // Insertion order preserved (web Map iteration): the busy bucket was seen first.
        val busy = clusters[0]
        val sparse = clusters[1]
        assertEquals(3, busy.count)
        assertEquals(10.0, busy.latitude, 1e-9)
        assertEquals(20.0, busy.longitude, 1e-9)
        assertEquals(1.0, busy.intensity, 1e-9)
        assertEquals(1, sparse.count)
        assertEquals(1.0 / 3.0, sparse.intensity, 1e-9)
    }

    @Test
    fun clusterPositionsSkipsZeroZeroReading() {
        val clusters =
            PositionHeatmapProjection.clusterPositions(
                listOf(HeatPosition(0.0, 0.0), HeatPosition(10.0, 20.0), HeatPosition(10.002, 20.0)),
                PositionHeatmapProjection.STANDARD_PRECISION,
            )
        // 0,0 is skipped (web `continue`); 10.0 and 10.002 (×500 → 5000 and 5001) land in different buckets.
        assertEquals(2, clusters.size)
        assertTrue(clusters.all { it.count == 1 })
    }

    @Test
    fun clusterPositionsMergesWithinTruncatedBucket() {
        // 10.000*500 = 5000.0 → 5000 ; 10.001*500 = 5000.5 → 5000 (truncated toward zero, JS `| 0`).
        val clusters =
            PositionHeatmapProjection.clusterPositions(
                listOf(HeatPosition(10.000, 20.0), HeatPosition(10.001, 20.0)),
                PositionHeatmapProjection.STANDARD_PRECISION,
            )
        assertEquals(1, clusters.size)
        assertEquals(2, clusters[0].count)
        assertEquals(10.0005, clusters[0].latitude, 1e-9)
    }

    @Test
    fun clusterPositionsEmptyWhenAllZeroOrEmpty() {
        assertTrue(PositionHeatmapProjection.clusterPositions(emptyList(), 500).isEmpty())
        assertTrue(
            PositionHeatmapProjection
                .clusterPositions(listOf(HeatPosition(0.0, 0.0), HeatPosition(0.0, 0.0)), 500)
                .isEmpty(),
        )
    }

    // ---- centroid ------------------------------------------------------------------

    @Test
    fun centroidAveragesClusters() {
        val points = PositionHeatmapProjection.clusterPositions(twoBucketPositions(), 500)
        assertEquals(GeoPoint(25.0, 35.0), PositionHeatmapProjection.centroid(points))
    }

    @Test
    fun centroidFallsBackToSanFranciscoWhenEmpty() {
        val center = PositionHeatmapProjection.centroid(emptyList())
        assertEquals(PositionHeatmapProjection.FALLBACK_LATITUDE, center.lat, 1e-9)
        assertEquals(PositionHeatmapProjection.FALLBACK_LONGITUDE, center.lng, 1e-9)
    }

    // ---- intensityColor (web cool-cyan → hot-magenta ramp) -------------------------

    @Test
    fun intensityColorRampMatchesWeb() {
        assertEquals(HeatColor(20, 184, 166), PositionHeatmapProjection.intensityColor(0.0))
        assertEquals(HeatColor(245, 64, 226), PositionHeatmapProjection.intensityColor(1.0))
        assertEquals(HeatColor(133, 124, 196), PositionHeatmapProjection.intensityColor(0.5))
        assertEquals(HeatColor(95, 144, 186), PositionHeatmapProjection.intensityColor(1.0 / 3.0))
    }

    // ---- projection: standard footprint --------------------------------------------

    @Test
    fun projectStandardStylesClustersAndShowsTitleNoBadge() {
        val display = PositionHeatmapProjection.project(twoBucketPositions(), PositionHeatmapSize.Default, strings())
        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertFalse(display.isWide)
        assertTrue(display.showTitle)
        assertFalse(display.showBadge)
        assertEquals(4, display.totalPositions)
        assertEquals(GeoPoint(25.0, 35.0), display.center)
        assertEquals(PositionHeatmapProjection.STANDARD_ZOOM, display.zoom)
        assertEquals(2, display.clusters.size)

        val hot = display.clusters[0]
        assertEquals(245, hot.red)
        assertEquals(64, hot.green)
        assertEquals(226, hot.blue)
        assertEquals(16f, hot.radiusDp, 1e-3f)
        // colorAlpha 0.9 × fillOpacity 0.9 = 0.81.
        assertEquals(0.81f, hot.fillAlpha, 1e-3f)

        val cool = display.clusters[1]
        assertEquals(HeatColor(95, 144, 186), HeatColor(cool.red, cool.green, cool.blue))
        assertEquals(6f + (1f / 3f) * 10f, cool.radiusDp, 1e-3f)
        assertEquals("Position Heatmap, 4 positions", display.mapContentDescription)
    }

    // ---- projection: wide footprint shows the count badge + larger circles + zoom 12 ---

    @Test
    fun projectWideShowsBadgeAndWiderCircles() {
        val display = PositionHeatmapProjection.project(twoBucketPositions(), PositionHeatmapSize(cols = 3, rows = 4), strings())
        assertTrue(display.isWide)
        assertTrue(display.showTitle)
        assertTrue(display.showBadge)
        assertEquals("4 positions", display.countText)
        assertEquals(PositionHeatmapProjection.WIDE_ZOOM, display.zoom)
        // Hot cluster radius widens to 6 + 1.0*14 = 20.
        assertEquals(20f, display.clusters[0].radiusDp, 1e-3f)
    }

    // ---- projection: compact footprint coarsens the grid + hides the title ----------

    @Test
    fun projectCompactCoarseGridSmallestCirclesNoTitle() {
        val display = PositionHeatmapProjection.project(twoBucketPositions(), PositionHeatmapSize(cols = 1, rows = 4), strings())
        assertTrue(display.isCompact)
        assertFalse(display.showTitle)
        assertFalse(display.showBadge)
        assertEquals(PositionHeatmapProjection.STANDARD_ZOOM, display.zoom)
        // Compact hot circle: 4 + 1.0*6 = 10 ; colorAlpha 0.9 × fillOpacity (0.4+0.5)=0.9 → 0.81.
        assertEquals(10f, display.clusters[0].radiusDp, 1e-3f)
        assertEquals(0.81f, display.clusters[0].fillAlpha, 1e-3f)
    }

    // ---- projection: empty gate (web clusters.length === 0) -------------------------

    @Test
    fun projectEmptyWhenNoPositions() {
        val display = PositionHeatmapProjection.project(emptyList(), PositionHeatmapSize.Default, strings())
        assertFalse(display.hasData)
        assertTrue(display.clusters.isEmpty())
        assertEquals(0, display.totalPositions)
        assertEquals("No position data", display.mapContentDescription)
        // Empty map still gets the SF fallback camera.
        assertEquals(PositionHeatmapProjection.FALLBACK_LATITUDE, display.center.lat, 1e-9)
    }

    @Test
    fun projectAllZeroIsEmptyButStillCountsTotalForBadge() {
        val display =
            PositionHeatmapProjection.project(
                listOf(HeatPosition(0.0, 0.0), HeatPosition(0.0, 0.0)),
                PositionHeatmapSize(cols = 3, rows = 4),
                strings(),
            )
        assertFalse(display.hasData)
        assertEquals(2, display.totalPositions)
        // web: totalPositions counts every reading, so a wide footprint still shows the badge.
        assertTrue(display.showBadge)
        assertEquals("2 positions", display.countText)
    }

    // ---- registry metadata ---------------------------------------------------------

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("position-heatmap", PositionHeatmapRegistration.ID)
        assertEquals("maps", PositionHeatmapRegistration.CATEGORY)
        assertEquals("PositionHeatmapWidget", PositionHeatmapRegistration.SLUG)
        assertEquals(PositionHeatmapSize(cols = 2, rows = 4), PositionHeatmapRegistration.defaultSize)
        assertEquals(PositionHeatmapSize(cols = 2, rows = 4), PositionHeatmapRegistration.minSize)
        assertEquals(PositionHeatmapSize(cols = 4, rows = 40), PositionHeatmapRegistration.maxSize)
    }

    @Test
    fun sizeWithinBoundsAndClamp() {
        assertTrue(PositionHeatmapRegistration.withinBounds(PositionHeatmapSize(cols = 2, rows = 4)))
        assertFalse(PositionHeatmapRegistration.withinBounds(PositionHeatmapSize(cols = 1, rows = 4)))
        assertFalse(PositionHeatmapRegistration.withinBounds(PositionHeatmapSize(cols = 5, rows = 50)))
        assertEquals(PositionHeatmapSize(cols = 4, rows = 40), PositionHeatmapRegistration.clamp(PositionHeatmapSize(cols = 9, rows = 99)))
        assertEquals(PositionHeatmapSize(cols = 2, rows = 4), PositionHeatmapRegistration.clamp(PositionHeatmapSize(cols = 1, rows = 1)))
    }

    // ---- /positions JSON decode ----------------------------------------------------

    @Test
    fun parseHeatPositionsDecodesLatLonArray() {
        val json = Json.parseToJsonElement("""[{"latitude":10.0,"longitude":20.0},{"latitude":40.5,"longitude":-50.25}]""")
        assertEquals(listOf(HeatPosition(10.0, 20.0), HeatPosition(40.5, -50.25)), json.parseHeatPositions())
    }

    @Test
    fun parseHeatPositionsDefaultsMissingCoordinateToZero() {
        val json = Json.parseToJsonElement("""[{"latitude":10.0},{"longitude":20.0},{}]""")
        assertEquals(
            listOf(HeatPosition(10.0, 0.0), HeatPosition(0.0, 20.0), HeatPosition(0.0, 0.0)),
            json.parseHeatPositions(),
        )
    }

    @Test
    fun parseHeatPositionsNonArrayIsEmpty() {
        assertTrue(Json.parseToJsonElement("""{"latitude":1.0}""").parseHeatPositions().isEmpty())
    }

    // ---- cache-then-network Resource mapper ----------------------------------------

    @Test
    fun toHeatPositionsPreservesSuccess() {
        val element = Json.parseToJsonElement("""[{"latitude":1.0,"longitude":2.0}]""")
        val mapped = Resource.Success(element, fetchedAt = 200L, stale = false).toHeatPositions()
        assertTrue(mapped is Resource.Success)
        mapped as Resource.Success
        assertEquals(listOf(HeatPosition(1.0, 2.0)), mapped.data)
        assertEquals(200L, mapped.fetchedAt)
    }

    @Test
    fun toHeatPositionsPreservesLoadingCacheAndStamp() {
        val cached = Json.parseToJsonElement("""[{"latitude":3.0,"longitude":4.0}]""")
        val mapped = Resource.Loading(cached = cached, fetchedAt = 100L, stale = false).toHeatPositions()
        assertTrue(mapped is Resource.Loading)
        mapped as Resource.Loading
        assertEquals(listOf(HeatPosition(3.0, 4.0)), mapped.cached)
        assertEquals(100L, mapped.fetchedAt)
    }

    @Test
    fun toHeatPositionsPreservesErrorCacheAndStaleFlag() {
        val cached = Json.parseToJsonElement("""[{"latitude":5.0,"longitude":6.0}]""")
        val cause = ApiError.Timeout()
        val mapped = Resource.Error(cached = cached, fetchedAt = 300L, stale = true, error = cause).toHeatPositions()
        assertTrue(mapped is Resource.Error)
        mapped as Resource.Error
        assertEquals(listOf(HeatPosition(5.0, 6.0)), mapped.cached)
        assertTrue(mapped.stale)
        assertEquals(cause, mapped.error)
    }
}
