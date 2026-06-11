package io.teslasync.android.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** JVM unit tests for [PushPayloadParser] — tolerant decode of the FCM data map + notification fields. */
class PushPayloadParserTest {
    @Test
    fun emptyMessageYieldsUnknown() {
        assertSame(PushPayload.Unknown, PushPayloadParser.parse(emptyMap()))
    }

    @Test
    fun readsKindTitleBodyAndCategoryFromData() {
        val payload =
            PushPayloadParser.parse(
                mapOf("kind" to "alert", "title" to "Low battery", "body" to "Down to 12%", "category" to "critical"),
            )
        assertEquals("alert", payload.kind)
        assertEquals("Low battery", payload.title)
        assertEquals("Down to 12%", payload.body)
        assertEquals("critical", payload.category)
    }

    @Test
    fun fallsBackToTypeForKindAndMessageForBody() {
        val payload = PushPayloadParser.parse(mapOf("type" to "charge_complete", "message" to "Charging complete"))
        assertEquals("charge_complete", payload.kind)
        assertEquals("Charging complete", payload.body)
    }

    @Test
    fun usesNotificationTitleBodyWhenDataOmitsThem() {
        val payload = PushPayloadParser.parse(mapOf("kind" to "generic"), notificationTitle = "Hi", notificationBody = "There")
        assertEquals("Hi", payload.title)
        assertEquals("There", payload.body)
    }

    @Test
    fun dataTitleWinsOverNotificationTitle() {
        val payload = PushPayloadParser.parse(mapOf("title" to "Data title"), notificationTitle = "Notif title")
        assertEquals("Data title", payload.title)
    }

    @Test
    fun missingKindDefaultsToUnknownKind() {
        val payload = PushPayloadParser.parse(mapOf("title" to "No kind"))
        assertEquals(PushPayload.UNKNOWN_KIND, payload.kind)
        assertNull(payload.category)
    }
}
