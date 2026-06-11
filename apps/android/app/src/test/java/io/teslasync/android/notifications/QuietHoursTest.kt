package io.teslasync.android.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for [QuietHours] — same-day and wrap-past-midnight windows (P3/A6). */
class QuietHoursTest {
    @Test
    fun disabledIsNeverQuiet() {
        assertFalse(QuietHours.Disabled.isQuiet(0))
        assertFalse(QuietHours.Disabled.isQuiet(720))
    }

    @Test
    fun sameDayWindowIsInclusiveOfStartExclusiveOfEnd() {
        val window = QuietHours(enabled = true, startMinuteOfDay = 600, endMinuteOfDay = 700)
        assertFalse(window.isQuiet(599))
        assertTrue(window.isQuiet(600))
        assertTrue(window.isQuiet(650))
        assertFalse(window.isQuiet(700))
    }

    @Test
    fun windowWrappingPastMidnightIncludesBothEnds() {
        val window = QuietHours(enabled = true, startMinuteOfDay = 1320, endMinuteOfDay = 420)
        assertTrue(window.isQuiet(1380))
        assertTrue(window.isQuiet(60))
        assertFalse(window.isQuiet(720))
    }

    @Test
    fun zeroLengthWindowIsNeverQuiet() {
        val window = QuietHours(enabled = true, startMinuteOfDay = 480, endMinuteOfDay = 480)
        assertFalse(window.isQuiet(480))
    }
}
