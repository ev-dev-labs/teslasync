package io.teslasync.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the pure [NotificationActions] kind → action-button mapping (P3/A8). */
class NotificationActionsTest {
    @Test
    fun alertOffersAcknowledgeThenOpen() {
        val actions = NotificationActions.actionsFor(content(NotificationKind.Alert, "notifications/alerts"))
        assertEquals(listOf(NotificationActionId.Acknowledge, NotificationActionId.Open), actions.map { it.id })

        val acknowledge = actions.first()
        assertEquals(NotificationActionBehavior.Acknowledge, acknowledge.behavior)
        assertFalse("acknowledge must not require unlock — it reveals nothing", acknowledge.authRequired)

        val open = actions.last()
        assertEquals(NotificationActionBehavior.Open, open.behavior)
        assertEquals("notifications/alerts", open.deepLinkPath)
        assertTrue("opening surfaces account data — require unlock", open.authRequired)
    }

    @Test
    fun chargeCompleteOpensTheSession() {
        val actions = NotificationActions.actionsFor(content(NotificationKind.ChargeComplete, "charging/42"))
        assertEquals(listOf(NotificationActionId.OpenSession), actions.map { it.id })
        assertEquals("charging/42", actions.single().deepLinkPath)
        assertTrue(actions.single().authRequired)
    }

    @Test
    fun commandResultOpensCommandHistory() {
        val actions = NotificationActions.actionsFor(content(NotificationKind.CommandResult, "command-history"))
        assertEquals(listOf(NotificationActionId.OpenHistory), actions.map { it.id })
        assertEquals("command-history", actions.single().deepLinkPath)
    }

    @Test
    fun incidentAndReauthOpenTheirTargets() {
        val incident = NotificationActions.actionsFor(content(NotificationKind.SystemIncident, "system-status"))
        assertEquals(listOf(NotificationActionId.OpenIncident), incident.map { it.id })

        val reauth = NotificationActions.actionsFor(content(NotificationKind.ReauthNeeded, "settings"))
        assertEquals(listOf(NotificationActionId.SignIn), reauth.map { it.id })
        assertEquals("settings", reauth.single().deepLinkPath)
    }

    @Test
    fun quieterKindsOfferAQuietHoursShortcut() {
        listOf(NotificationKind.VehicleState, NotificationKind.Automation, NotificationKind.Generic).forEach { kind ->
            val actions = NotificationActions.actionsFor(content(kind, "vehicles"))
            assertEquals("kind $kind should offer quiet hours", listOf(NotificationActionId.QuietHours), actions.map { it.id })
            assertEquals("notifications/quiet-hours", actions.single().deepLinkPath)
        }
    }

    @Test
    fun anUnknownOpenTargetFallsBackToTheInbox() {
        val actions = NotificationActions.actionsFor(content(NotificationKind.Alert, "no/such/route"))
        assertEquals(NotificationRouteMap.INBOX_PATH, actions.last().deepLinkPath)
    }

    @Test
    fun wireTokensRoundTrip() {
        NotificationActionId.entries.forEach { id ->
            assertEquals(id, NotificationActionId.fromWire(id.wire))
        }
        assertEquals(null, NotificationActionId.fromWire("not-a-real-action"))
    }
}
