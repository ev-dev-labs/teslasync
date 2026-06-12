package io.teslasync.android.featureviews.sessionlist

import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the SessionList's pure logic — the native analogue of everything the web component
 * derives from a `ChatSessionInfo` (web/src/features/system/components/chatbot/SessionList.tsx): the visible
 * title (web `displayTitle`: explicit title → first message truncated to 60 → null/"Untitled"), the tolerant
 * `last_message_at` parse, the relative-age bucketing the web `formatRelative` renders, and the absolute-date
 * fallback. Runs in the :android:testReleaseUnitTest gate.
 */
class SessionListProjectionTest {
    private fun session(
        id: String = "s1",
        title: String? = null,
        firstMessage: String? = null,
        messageCount: Int = 0,
        lastMessageAt: String? = null,
    ): ChatSessionInfo =
        ChatSessionInfo(
            id = id,
            title = title,
            firstMessage = firstMessage,
            messageCount = messageCount,
            lastMessageAt = lastMessageAt,
        )

    // ── Title resolution (web displayTitle) ───────────────────────────────────────

    @Test
    fun resolveTitlePrefersAnExplicitTrimmedTitle() {
        assertEquals("Charging cost", SessionListProjection.resolveTitle(session(title = "  Charging cost  ")))
    }

    @Test
    fun resolveTitleFallsBackToTheFirstMessageWhenTitleBlank() {
        assertEquals(
            "Why is my SoC dropping?",
            SessionListProjection.resolveTitle(session(title = "   ", firstMessage = "Why is my SoC dropping?")),
        )
    }

    @Test
    fun resolveTitleTruncatesALongFirstMessageToSixtyCharsPlusEllipsis() {
        val long = "a".repeat(70)
        val resolved = SessionListProjection.resolveTitle(session(firstMessage = long))
        assertEquals("a".repeat(TITLE_MAX_CHARS) + ELLIPSIS, resolved)
        assertEquals(TITLE_MAX_CHARS + 1, resolved!!.length)
    }

    @Test
    fun resolveTitleKeepsAFirstMessageOfExactlySixtyChars() {
        val exact = "b".repeat(TITLE_MAX_CHARS)
        assertEquals(exact, SessionListProjection.resolveTitle(session(firstMessage = exact)))
    }

    @Test
    fun resolveTitleReturnsNullWhenNeitherTitleNorFirstMessagePresent() {
        assertNull(SessionListProjection.resolveTitle(session(title = null, firstMessage = "   ")))
        assertNull(SessionListProjection.resolveTitle(session(title = null, firstMessage = null)))
    }

    // ── Timestamp parse (web new Date(iso)) ───────────────────────────────────────

    @Test
    fun parseTimestampAcceptsInstantOffsetAndZonelessForms() {
        val expected = Instant.parse("2026-04-04T14:30:00Z")
        assertEquals(expected, SessionListProjection.parseTimestamp("2026-04-04T14:30:00Z"))
        assertEquals(expected, SessionListProjection.parseTimestamp("2026-04-04T14:30:00+00:00"))
        assertEquals(expected, SessionListProjection.parseTimestamp("2026-04-04T14:30:00"))
    }

    @Test
    fun parseTimestampReturnsNullForBlankOrUnparseable() {
        assertNull(SessionListProjection.parseTimestamp(null))
        assertNull(SessionListProjection.parseTimestamp(""))
        assertNull(SessionListProjection.parseTimestamp("   "))
        assertNull(SessionListProjection.parseTimestamp("not-a-date"))
    }

    // ── Relative-age bucketing (web formatRelative cutoffs) ───────────────────────

    @Test
    fun relativeAgeBucketsMatchTheWebFormatRelativeCutoffs() {
        val now = Instant.parse("2026-06-12T12:00:00Z")
        val nowMs = now.toEpochMilli()

        assertEquals(SessionRelativeAge.JustNow, SessionListProjection.relativeAge(now.minusSeconds(30), nowMs))
        assertEquals(SessionRelativeAge.Minutes(5), SessionListProjection.relativeAge(now.minusSeconds(5 * 60), nowMs))
        assertEquals(SessionRelativeAge.Hours(3), SessionListProjection.relativeAge(now.minusSeconds(3 * 3_600), nowMs))
        assertEquals(SessionRelativeAge.Days(2), SessionListProjection.relativeAge(now.minusSeconds(2 * 86_400), nowMs))
    }

    @Test
    fun relativeAgeFallsBackToAbsoluteAtOneWeekOrOlder() {
        val now = Instant.parse("2026-06-12T12:00:00Z")
        val old = now.minusSeconds(8 * 86_400)
        assertEquals(SessionRelativeAge.Absolute(old), SessionListProjection.relativeAge(old, now.toEpochMilli()))
    }

    @Test
    fun relativeAgeTreatsFutureTimestampsAsJustNow() {
        val now = Instant.parse("2026-06-12T12:00:00Z")
        val future = now.plusSeconds(3_600)
        assertEquals(SessionRelativeAge.JustNow, SessionListProjection.relativeAge(future, now.toEpochMilli()))
    }

    @Test
    fun relativeAgeReturnsNullForANullInstant() {
        assertNull(SessionListProjection.relativeAge(null, Instant.parse("2026-06-12T12:00:00Z").toEpochMilli()))
    }

    // ── Absolute format (web formatDate fallback) ─────────────────────────────────

    @Test
    fun formatAbsoluteRendersALocalizedDateInZone() {
        val instant = Instant.parse("2026-04-04T05:00:00Z")
        assertEquals("Apr 4, 2026", SessionListProjection.formatAbsolute(instant, ZoneOffset.UTC, Locale.US))
        assertEquals(
            "Apr 3, 2026",
            SessionListProjection.formatAbsolute(instant, ZoneId.of("America/Los_Angeles"), Locale.US),
        )
    }

    // ── Full projection ───────────────────────────────────────────────────────────

    @Test
    fun projectMapsARenamedSessionWithATimestamp() {
        val row =
            SessionListProjection.project(
                session(
                    id = "abc",
                    title = "My chat",
                    firstMessage = "hello",
                    messageCount = 7,
                    lastMessageAt = "2026-04-04T14:30:00Z",
                ),
            )

        assertEquals("abc", row.id)
        assertEquals("My chat", row.title)
        assertTrue(row.hasLastMessageAt)
        assertEquals(Instant.parse("2026-04-04T14:30:00Z"), row.lastMessageAt)
        assertEquals(7, row.messageCount)
    }

    @Test
    fun projectFlagsAnAbsentTimestampAndAnUntitledSession() {
        val row = SessionListProjection.project(session(id = "x", title = null, firstMessage = null))

        assertNull(row.title)
        assertEquals(false, row.hasLastMessageAt)
        assertNull(row.lastMessageAt)
    }

    @Test
    fun projectMarksAPresentButUnparseableTimestamp() {
        val row = SessionListProjection.project(session(lastMessageAt = "bad-date"))

        assertTrue(row.hasLastMessageAt)
        assertNull(row.lastMessageAt)
    }
}
