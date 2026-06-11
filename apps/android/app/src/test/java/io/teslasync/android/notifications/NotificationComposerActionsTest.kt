package io.teslasync.android.notifications

import io.teslasync.android.push.PushPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Verifies [NotificationComposer] attaches the kind's action buttons to the composed content (P3/A8). */
class NotificationComposerActionsTest {
    @Test
    fun composedAlertCarriesAcknowledgeAndOpenActions() {
        val payload = PushPayload("alert", "Low battery", "Down to 12%", "critical", emptyMap())
        val content = NotificationComposer.compose(payload, NotificationSettings.Default)

        assertEquals(
            listOf(NotificationActionId.Acknowledge, NotificationActionId.Open),
            content.actions.map { it.id },
        )
    }

    @Test
    fun composedChargeCompleteCarriesAnOpenSessionAction() {
        val payload = PushPayload("charge_complete", "Charged", "Reached 80%", null, mapOf("session_id" to "42"))
        val content = NotificationComposer.compose(payload, NotificationSettings.Default)

        assertEquals(listOf(NotificationActionId.OpenSession), content.actions.map { it.id })
        assertTrue(content.actions.single().authRequired)
    }
}
