package io.teslasync.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JVM unit tests for [NotificationRouteMap] — kind → in-app route resolution validated against the real
 * navigation registry, entity-id substitution, explicit-route override and deep-link URI building.
 */
class NotificationRouteMapTest {
    @Test
    fun alertResolvesToTheAlertsRoute() {
        assertEquals("notifications/alerts", NotificationRouteMap.resolve(NotificationKind.Alert, emptyMap()).path)
    }

    @Test
    fun chargeCompleteUsesTheSessionIdWhenPresent() {
        val resolved = NotificationRouteMap.resolve(NotificationKind.ChargeComplete, mapOf("session_id" to "42"))
        assertEquals("charging/42", resolved.path)
        assertEquals("42", resolved.entityId)
    }

    @Test
    fun chargeCompleteFallsBackToTheChargingLanding() {
        assertEquals("charging", NotificationRouteMap.resolve(NotificationKind.ChargeComplete, emptyMap()).path)
    }

    @Test
    fun vehicleStateUsesTheVehicleId() {
        assertEquals("vehicles/3", NotificationRouteMap.resolve(NotificationKind.VehicleState, mapOf("vehicle_id" to "3")).path)
    }

    @Test
    fun systemIncidentUsesTheIncidentId() {
        val resolved = NotificationRouteMap.resolve(NotificationKind.SystemIncident, mapOf("incident_id" to "9"))
        assertEquals("system-status/incidents/9", resolved.path)
    }

    @Test
    fun reauthResolvesToSettingsAndGenericToTheInbox() {
        assertEquals("settings", NotificationRouteMap.resolve(NotificationKind.ReauthNeeded, emptyMap()).path)
        assertEquals(NotificationRouteMap.INBOX_PATH, NotificationRouteMap.resolve(NotificationKind.Generic, emptyMap()).path)
    }

    @Test
    fun anExplicitValidRouteWins() {
        val resolved = NotificationRouteMap.resolve(NotificationKind.Generic, mapOf("route" to "/battery"))
        assertEquals("battery", resolved.path)
    }

    @Test
    fun anExplicitInvalidRouteFallsThroughToTheKindCandidate() {
        val resolved = NotificationRouteMap.resolve(NotificationKind.Alert, mapOf("route" to "/no-such-page"))
        assertEquals("notifications/alerts", resolved.path)
    }

    @Test
    fun anUnsafeEntityIdIsIgnored() {
        val resolved = NotificationRouteMap.resolve(NotificationKind.VehicleState, mapOf("vehicle_id" to "../secrets"))
        assertEquals("vehicles", resolved.path)
        assertNull(resolved.entityId)
    }

    @Test
    fun deepLinkUriUsesTheAppScheme() {
        assertEquals(
            "teslasync://app/notifications/inbox",
            NotificationRouteMap.deepLinkUri(NotificationKind.Generic, emptyMap()),
        )
        assertEquals(
            "teslasync://app/vehicles/7",
            NotificationRouteMap.deepLinkUri(NotificationKind.VehicleState, mapOf("vehicle_id" to "7")),
        )
    }
}
