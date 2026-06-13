package io.teslasync.android.sharedsurfaces.announcerregion

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AnnouncerRegion surface's pure logic — the native analogue of the web
 * `useAnnouncer` module (web/src/hooks/useAnnouncer.ts): the [Announcer] state holder's priority routing,
 * the empty-message skip, the rotating zero-width-space de-duplication that forces a live region to re-voice
 * an identical consecutive message, the [Announcer.reset] contract, the [GlobalAnnouncer] singleton, and the
 * PII-safe `view.opened` diagnostic. Runs in the offline `:android:testReleaseUnitTest` gate; the Compose
 * rendering + accessibility are covered on-device by AnnouncerRegionUiTest.
 */
class AnnouncerRegionModelTest {
    // ── Priority routing (web `priority === 'assertive' ? setAssertive : setPolite`) ──────────────────

    @Test
    fun politeAnnouncementUpdatesOnlyThePoliteRegion() {
        val announcer = Announcer()

        announcer.announce("Filter applied", AnnouncerPriority.Polite)

        assertTrue(announcer.polite.value.startsWith("Filter applied"))
        assertEquals("", announcer.assertive.value)
    }

    @Test
    fun assertiveAnnouncementUpdatesOnlyTheAssertiveRegion() {
        val announcer = Announcer()

        announcer.announce("Session expired", AnnouncerPriority.Assertive)

        assertTrue(announcer.assertive.value.startsWith("Session expired"))
        assertEquals("", announcer.polite.value)
    }

    @Test
    fun defaultPriorityIsPolite() {
        val announcer = Announcer()

        announcer.announce("Saved view applied")

        assertTrue(announcer.polite.value.startsWith("Saved view applied"))
        assertEquals("", announcer.assertive.value)
    }

    // ── Empty-message skip (web `if (!message) return`) ───────────────────────────────────────────────

    @Test
    fun emptyMessageIsIgnored() {
        val announcer = Announcer()

        announcer.announce("")
        announcer.announce("", AnnouncerPriority.Assertive)

        assertEquals("", announcer.polite.value)
        assertEquals("", announcer.assertive.value)
    }

    // ── De-duplication: rotating zero-width-space suffix (web `'\u200B'.repeat(counter % 4)`) ──────────

    @Test
    fun repeatedIdenticalMessagesProduceDistinctValuesSoTheRegionReAnnounces() {
        val announcer = Announcer()

        announcer.announce("Selection cleared")
        val first = announcer.polite.value
        announcer.announce("Selection cleared")
        val second = announcer.polite.value

        // A StateFlow would suppress an equal re-set; the rotating suffix makes the two values distinct so a
        // live region re-voices the identical message.
        assertNotEquals(first, second)
        assertTrue(first.startsWith("Selection cleared"))
        assertTrue(second.startsWith("Selection cleared"))
    }

    @Test
    fun deduplicationSuffixRotatesModuloFour() {
        val announcer = Announcer()
        val zwsp = Announcer.ZERO_WIDTH_SPACE

        val suffixLengths =
            (1..5).map { _ ->
                announcer.announce("x")
                val message = announcer.polite.value
                suffixLength(message, "x")
            }

        // counter increments 1,2,3,4,5 → suffix run-length = counter % 4 = 1,2,3,0,1.
        assertEquals(listOf(1, 2, 3, 0, 1), suffixLengths)
        // The suffix is composed solely of zero-width spaces (inaudible to TalkBack).
        val suffix = announcer.polite.value.removePrefix("x")
        assertTrue(suffix.all { it.toString() == zwsp })
    }

    @Test
    fun theRotationCounterIsSharedAcrossBothPriorities() {
        val announcer = Announcer()

        announcer.announce("a", AnnouncerPriority.Polite) // counter 1 → 1 suffix
        announcer.announce("b", AnnouncerPriority.Assertive) // counter 2 → 2 suffix

        val politeMessage = announcer.polite.value
        val assertiveMessage = announcer.assertive.value
        assertEquals(1, suffixLength(politeMessage, "a"))
        assertEquals(2, suffixLength(assertiveMessage, "b"))
    }

    // ── reset ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun resetClearsBothRegionsAndTheCounter() {
        val announcer = Announcer()
        announcer.announce("kept briefly")
        announcer.announce("also kept", AnnouncerPriority.Assertive)

        announcer.reset()

        assertEquals("", announcer.polite.value)
        assertEquals("", announcer.assertive.value)
        // Counter is back to 0, so the next announce starts the rotation at a 1-space suffix again.
        announcer.announce("after reset")
        val message = announcer.polite.value
        assertEquals(1, suffixLength(message, "after reset"))
    }

    // ── Singleton (web module-level store) ────────────────────────────────────────────────────────────

    @Test
    fun globalAnnouncerIsAReusableAnnouncerInstance() {
        assertSame(GlobalAnnouncer, GlobalAnnouncer)
        GlobalAnnouncer.reset()

        GlobalAnnouncer.announce("global ping")

        assertTrue(GlobalAnnouncer.polite.value.startsWith("global ping"))
        GlobalAnnouncer.reset()
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────

    @Test
    fun diagnosticsSlugMatchesThePromptMandatedSurfaceSlug() {
        assertEquals("AnnouncerRegion", AnnouncerRegionDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsThePiiSafeInfoEventOnce() {
        val logger = RecordingLogger()

        AnnouncerRegionDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        // Only the slug is logged — never any announced copy, which can carry user data.
        assertEquals(mapOf("surface" to "AnnouncerRegion"), fields)
    }

    /** Length of the trailing zero-width-space de-dup suffix on [message] after the literal [base]. */
    private fun suffixLength(
        message: String,
        base: String,
    ): Int {
        val suffix = message.removePrefix(base)
        return suffix.length
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
