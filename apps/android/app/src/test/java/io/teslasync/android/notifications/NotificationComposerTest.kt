package io.teslasync.android.notifications

import io.teslasync.android.push.PushPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for [NotificationComposer] — payload → content mapping, redaction and display gating. */
class NotificationComposerTest {
    private fun payload(
        kind: String = "alert",
        title: String? = "Low battery",
        body: String? = "Down to 12%",
        category: String? = null,
        data: Map<String, String> = emptyMap(),
    ): PushPayload = PushPayload(kind, title, body, category, data)

    @Test
    fun mapsKindChannelSeverityRouteAndDeepLink() {
        val content = NotificationComposer.compose(payload(), NotificationSettings.Default)
        assertEquals(NotificationKind.Alert, content.kind)
        assertEquals(NotificationChannels.CRITICAL_ALERTS, content.channelId)
        assertEquals(BannerSeverity.Critical, content.severity)
        assertEquals("notifications/alerts", content.routePath)
        assertEquals("teslasync://app/notifications/alerts", content.deepLinkUri)
        assertTrue(content.hasDisplayText)
    }

    @Test
    fun usesAnExplicitChannelHintFromData() {
        val content =
            NotificationComposer.compose(
                payload(kind = "generic", data = mapOf("channel" to "maintenance")),
                NotificationSettings.Default,
            )
        assertEquals(NotificationChannels.MAINTENANCE, content.channelId)
    }

    @Test
    fun leavesContentUnredactedByDefault() {
        val content = NotificationComposer.compose(payload(body = "VIN 5YJ3E1EA7KF317250 flagged"), NotificationSettings.Default)
        assertTrue(content.body.contains("5YJ3E1EA7KF317250"))
    }

    @Test
    fun redactsSensitiveContentWhenEnabled() {
        val settings = NotificationSettings(redactSensitiveContent = true)
        val content = NotificationComposer.compose(payload(body = "VIN 5YJ3E1EA7KF317250 flagged"), settings)
        assertFalse(content.body.contains("5YJ3E1EA7KF317250"))
        assertTrue(content.body.contains(NotificationRedaction.MASK))
    }

    @Test
    fun aPayloadWithNoTitleOrBodyHasNoDisplayText() {
        val content = NotificationComposer.compose(payload(title = null, body = null), NotificationSettings.Default)
        assertFalse(content.hasDisplayText)
    }
}
