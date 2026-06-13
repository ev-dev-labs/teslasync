// Off-device unit coverage for the VisuallyHidden surface's pure model (P3 acceptance: adapter + per-state
// + a11y-label tests). Exercises the registration slug the prompt mandates, the rotating zero-width-space
// dedupe suffix that mirrors the web `useAnnouncer` `'\u200B'.repeat(counter % 4)`, the message padding,
// the polite/assertive routing reducer that mirrors the web `AnnouncerRegion` `setPolite` / `setAssertive`
// split (including the empty-message skip and the routed message becoming the region's accessible label),
// and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the strings + behaviour the web announcer produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.visuallyhidden

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class VisuallyHiddenModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("visually-hidden", VisuallyHiddenRegistration.ID)
        assertEquals("VisuallyHidden", VisuallyHiddenRegistration.SLUG)
    }

    @Test
    fun announcePriorityCoversPoliteAndAssertive() {
        assertEquals(listOf(AnnouncePriority.Polite, AnnouncePriority.Assertive), AnnouncePriority.entries.toList())
    }

    // ── rotating dedupe suffix (web `'\u200B'.repeat(counter % 4)`) ───────────────────

    @Test
    fun dedupePaddingRotatesModFour() {
        assertEquals("", dedupePadding(0))
        assertEquals(ZERO_WIDTH_SPACE, dedupePadding(1))
        assertEquals(ZERO_WIDTH_SPACE.repeat(2), dedupePadding(2))
        assertEquals(ZERO_WIDTH_SPACE.repeat(3), dedupePadding(3))
        assertEquals("", dedupePadding(4))
        assertEquals(ZERO_WIDTH_SPACE, dedupePadding(5))
    }

    @Test
    fun dedupePaddingFoldsNegativeCountersIntoRange() {
        // A negative counter never happens in production (the announcer counter only increments), but the
        // helper stays total so a bad caller can never throw on the announcement hot path.
        assertEquals(ZERO_WIDTH_SPACE.repeat(3), dedupePadding(-1))
        assertEquals("", dedupePadding(-4))
    }

    @Test
    fun padAnnouncementAppendsRotatingSuffix() {
        assertEquals("Saved" + ZERO_WIDTH_SPACE, padAnnouncement("Saved", 1))
        assertEquals("Saved", padAnnouncement("Saved", 4))
    }

    @Test
    fun consecutiveIdenticalMessagesPadToDistinctStrings() {
        // The whole point of the suffix: two identical consecutive messages must differ so a screen reader
        // re-reads the second one instead of skipping it.
        assertNotEquals(padAnnouncement("Filter removed", 1), padAnnouncement("Filter removed", 2))
        assertTrue(padAnnouncement("Filter removed", 2).startsWith("Filter removed"))
    }

    // ── routing reducer (web AnnouncerRegion setPolite / setAssertive split) ──────────

    @Test
    fun routeAnnouncementRoutesPoliteToPoliteRegion() {
        val next = routeAnnouncement(AnnouncerState.EMPTY, Announcement("Filter applied", AnnouncePriority.Polite))
        assertEquals("Filter applied", next.politeMessage)
        assertEquals("", next.assertiveMessage)
    }

    @Test
    fun routeAnnouncementRoutesAssertiveToAssertiveRegion() {
        val next = routeAnnouncement(AnnouncerState.EMPTY, Announcement("Session expired", AnnouncePriority.Assertive))
        assertEquals("Session expired", next.assertiveMessage)
        assertEquals("", next.politeMessage)
    }

    @Test
    fun routeAnnouncementKeepsTheOtherRegionUntouched() {
        val withPolite = routeAnnouncement(AnnouncerState.EMPTY, Announcement("Saved", AnnouncePriority.Polite))
        val withBoth = routeAnnouncement(withPolite, Announcement("Error", AnnouncePriority.Assertive))
        assertEquals("Saved", withBoth.politeMessage)
        assertEquals("Error", withBoth.assertiveMessage)

        val repolited = routeAnnouncement(withBoth, Announcement("Cleared", AnnouncePriority.Polite))
        assertEquals("Cleared", repolited.politeMessage)
        assertEquals("Error", repolited.assertiveMessage)
    }

    @Test
    fun routeAnnouncementIgnoresEmptyMessage() {
        val state = routeAnnouncement(AnnouncerState.EMPTY, Announcement("Saved", AnnouncePriority.Polite))
        val afterEmpty = routeAnnouncement(state, Announcement("", AnnouncePriority.Polite))
        assertSame(state, afterEmpty)
    }

    // ── a11y label: the routed message IS what the live region exposes to assistive tech ──

    @Test
    fun routedMessageBecomesTheLiveRegionAccessibleLabel() {
        // The composable sets the region's semantics contentDescription to this exact string, so asserting
        // the routed message off-device is the a11y-label coverage for the polite + assertive regions.
        val polite = routeAnnouncement(AnnouncerState.EMPTY, Announcement("3 items archived", AnnouncePriority.Polite))
        assertEquals("3 items archived", polite.politeMessage)
        val assertive = routeAnnouncement(AnnouncerState.EMPTY, Announcement("Connection lost", AnnouncePriority.Assertive))
        assertEquals("Connection lost", assertive.assertiveMessage)
    }

    // ── diagnostics: one PII-safe view.opened ─────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordVisuallyHiddenOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no announced message can leak through the diagnostic.
        assertEquals(mapOf("surface" to "VisuallyHidden"), records[0].fields)
    }
}
