package io.teslasync.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for [NotificationRedaction] — masking VINs, GPS pairs and emails (P3/A6, ADR-016). */
class NotificationRedactionTest {
    @Test
    fun masksAVin() {
        val redacted = NotificationRedaction.redact("Vehicle 5YJ3E1EA7KF317250 is awake")
        assertFalse(redacted.contains("5YJ3E1EA7KF317250"))
        assertTrue(redacted.contains(NotificationRedaction.MASK))
    }

    @Test
    fun masksAGpsCoordinatePair() {
        val redacted = NotificationRedaction.redact("Parked at 37.422100, -122.084100")
        assertFalse(redacted.contains("37.422100"))
        assertTrue(redacted.contains(NotificationRedaction.MASK))
    }

    @Test
    fun masksAnEmailAddress() {
        val redacted = NotificationRedaction.redact("Shared with driver@example.com today")
        assertFalse(redacted.contains("driver@example.com"))
    }

    @Test
    fun leavesOrdinaryTextUntouched() {
        assertEquals("Charging complete at home", NotificationRedaction.redact("Charging complete at home"))
    }

    @Test
    fun nullOrEmptyYieldsEmpty() {
        assertEquals("", NotificationRedaction.redact(null))
        assertEquals("", NotificationRedaction.redact(""))
    }
}
