// Off-device unit coverage for the GeofenceDrawer surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the renderable-fence filter (the web render-sync effect's `fenceToLayer`-returns-null
// guard: a circle needs a strictly positive radius, web `radius > 0`; an area needs >= 3 vertices, web
// `polygon.length >= 3`), the order-preserving projection, the no-fences predicate, the accessible summary lines
// (reusing the shared `describeGeofence`), the default draw modes (web `modes = ['circle']`), the registry
// identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.geofencedrawer

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.GeofenceShape
import io.teslasync.android.components.maps.MapGeofence
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GeofenceDrawerModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    private val circle = MapGeofence("home", name = "Home", center = GeoPoint(37.7749, -122.4194), radiusMeters = 150.0)
    private val polygon =
        MapGeofence(
            "yard",
            name = "Yard",
            polygon = listOf(GeoPoint(0.0, 0.0), GeoPoint(0.0, 1.0), GeoPoint(1.0, 0.5)),
        )

    // ---- isRenderable (web `fenceToLayer` non-null guard) ------------------------

    @Test
    fun isRenderable_keepsCircleWithPositiveRadius() {
        assertTrue(GeofenceDrawerProjection.isRenderable(circle))
    }

    @Test
    fun isRenderable_dropsCircleWithNonPositiveOrMissingRadius() {
        // radius = 0 fails the web `radius > 0` guard, and there is no fallback ring.
        assertFalse(GeofenceDrawerProjection.isRenderable(MapGeofence("z", center = GeoPoint(1.0, 1.0), radiusMeters = 0.0)))
        // No radius and no ring -> nothing to draw.
        assertFalse(GeofenceDrawerProjection.isRenderable(MapGeofence("n", center = GeoPoint(1.0, 1.0))))
    }

    @Test
    fun isRenderable_keepsRingWithThreeOrMoreVerticesAndDropsFewer() {
        assertTrue(GeofenceDrawerProjection.isRenderable(polygon))
        assertFalse(
            GeofenceDrawerProjection.isRenderable(
                MapGeofence("line", polygon = listOf(GeoPoint(0.0, 0.0), GeoPoint(0.0, 1.0))),
            ),
        )
    }

    @Test
    fun isRenderable_fallsBackToRingWhenRadiusIsZeroButRingIsPresent() {
        // Web checks circle first (radius > 0 fails), then the polygon branch (length >= 3) renders the ring.
        val ringFence =
            MapGeofence(
                "rect",
                center = GeoPoint(2.0, 2.0),
                radiusMeters = 0.0,
                polygon = listOf(GeoPoint(0.0, 0.0), GeoPoint(0.0, 1.0), GeoPoint(1.0, 1.0), GeoPoint(1.0, 0.0)),
            )
        assertTrue(GeofenceDrawerProjection.isRenderable(ringFence))
    }

    // ---- renderableFences (web `fences.map(fenceToLayer).filter(Boolean)`) -------

    @Test
    fun renderableFences_filtersUnrenderableAndPreservesOrder() {
        val badRadius = MapGeofence("bad", center = GeoPoint(1.0, 1.0), radiusMeters = 0.0)
        val badRing = MapGeofence("seg", polygon = listOf(GeoPoint(0.0, 0.0), GeoPoint(0.0, 1.0)))
        val result = GeofenceDrawerProjection.renderableFences(listOf(circle, badRadius, polygon, badRing))
        assertEquals(listOf("home", "yard"), result.map { it.id })
    }

    @Test
    fun renderableFences_emptyWhenNothingDraws() {
        assertTrue(GeofenceDrawerProjection.renderableFences(emptyList()).isEmpty())
        val onlyBad = listOf(MapGeofence("bad", center = GeoPoint(1.0, 1.0), radiusMeters = 0.0))
        assertTrue(GeofenceDrawerProjection.renderableFences(onlyBad).isEmpty())
    }

    @Test
    fun hasFences_reflectsRenderableMembership() {
        assertTrue(GeofenceDrawerProjection.hasFences(listOf(circle)))
        assertFalse(GeofenceDrawerProjection.hasFences(emptyList()))
        assertFalse(
            GeofenceDrawerProjection.hasFences(
                listOf(MapGeofence("bad", center = GeoPoint(1.0, 1.0), radiusMeters = 0.0)),
            ),
        )
    }

    // ---- summaryLines (web `describeFence` accessible alternative) ---------------

    @Test
    fun summaryLines_describesOnlyRenderableFences() {
        val badRing = MapGeofence("seg", polygon = listOf(GeoPoint(0.0, 0.0), GeoPoint(0.0, 1.0)))
        val lines = GeofenceDrawerProjection.summaryLines(listOf(circle, polygon, badRing))
        assertEquals(2, lines.size)
        assertTrue(lines[0].contains("Home"))
        assertTrue(lines[0].contains("150m circle"))
        assertTrue(lines[1].contains("Yard"))
        assertTrue(lines[1].contains("polygon"))
    }

    // ---- Default modes (web `modes = ['circle']`) --------------------------------

    @Test
    fun defaultModes_areCircleOnly() {
        assertEquals(listOf(GeofenceShape.Circle), GeofenceDrawerProjection.DEFAULT_MODES)
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("geofence-drawer", GeofenceDrawerRegistration.ID)
        assertEquals("GeofenceDrawer", GeofenceDrawerRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordGeofenceDrawerOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "GeofenceDrawer"), fields)
    }
}
