package io.teslasync.android.widgets

import io.teslasync.android.navigation.RouteTable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Tests [WidgetDeepLinks]: every widget deep-links to its exact `teslasync://app/...` route, the
 * vehicle-status widget can pin a vehicle id, and every resolved route is a REAL destination in the
 * shared [RouteTable] (never the not-found fallback) — so a tap can never open a non-existent route.
 */
class WidgetDeepLinksTest {
    @Test
    fun vehicleStatusUriOpensGlance() {
        assertEquals("teslasync://app/glance", WidgetDeepLinks.uri(WidgetKind.VehicleStatus))
    }

    @Test
    fun vehicleStatusUriPinsVehicleId() {
        assertEquals("teslasync://app/glance?vehicle_id=7", WidgetDeepLinks.uri(WidgetKind.VehicleStatus, vehicleId = 7L))
    }

    @Test
    fun chargingUriOpensCharging() {
        assertEquals("teslasync://app/charging", WidgetDeepLinks.uri(WidgetKind.Charging))
    }

    @Test
    fun quickStatsUriOpensQuickStats() {
        assertEquals("teslasync://app/quick-stats", WidgetDeepLinks.uri(WidgetKind.QuickStats))
    }

    @Test
    fun alertsUriOpensAlerts() {
        assertEquals("teslasync://app/notifications/alerts", WidgetDeepLinks.uri(WidgetKind.Alerts))
    }

    @Test
    fun everyResolvedRouteIsRealDestination() {
        for (kind in WidgetKind.entries) {
            val path = WidgetDeepLinks.resolvedPath(kind)
            val destination = RouteTable.match(path)
            assertNotNull("resolved path for $kind should match a destination", destination)
            assertNotEquals("resolved path for $kind must not be the not-found route", RouteTable.notFound.id, destination?.id)
            assertEquals(kind.routePath, path)
        }
    }
}
