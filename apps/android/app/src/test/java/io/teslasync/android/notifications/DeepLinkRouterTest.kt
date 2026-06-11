package io.teslasync.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JVM unit tests for [DeepLinkRouter] and [NotificationIntent] — the notification-tap deep-link bridge
 * and the untrusted-extra scheme validation (P3/A6, ADR-009).
 */
class DeepLinkRouterTest {
    @Test
    fun requestPublishesTheUriAndConsumeClearsIt() {
        val router = DeepLinkRouter()
        assertNull(router.links.value)

        router.request("teslasync://app/vehicles/3")
        assertEquals("teslasync://app/vehicles/3", router.links.value)

        router.consume()
        assertNull(router.links.value)
    }

    @Test
    fun sanitizeAcceptsTheAppScheme() {
        assertEquals(
            "teslasync://app/notifications/inbox",
            NotificationIntent.sanitize("teslasync://app/notifications/inbox"),
        )
    }

    @Test
    fun sanitizeRejectsForeignSchemesAndNull() {
        assertNull(NotificationIntent.sanitize("https://evil.example.com/phish"))
        assertNull(NotificationIntent.sanitize("intent://app/x"))
        assertNull(NotificationIntent.sanitize(null))
    }
}
