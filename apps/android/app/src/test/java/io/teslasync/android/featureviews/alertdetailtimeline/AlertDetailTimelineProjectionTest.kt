package io.teslasync.android.featureviews.alertdetailtimeline

import io.teslasync.shared.core.presentation.notifications.AlertEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the Alert Detail Timeline's pure logic — the native analogue of the web
 * component's `useMemo` block (web/src/features/admin/components/AlertDetailTimeline.tsx): the kind
 * classification, the actor-vs-anonymous title selection with the web fallbacks, the events → rows
 * projection (empty guard, note subtitle, order preserved, injected time formatter), and the tolerant
 * ISO-8601 timestamp formatting with its em-dash guard. Runs in the :android:testReleaseUnitTest gate.
 */
class AlertDetailTimelineProjectionTest {
    private val strings =
        AlertDetailTimelineStrings(
            title = "Audit timeline",
            empty = "No events yet",
            kinds =
                AlertKindTitles(
                    created = "Alert created",
                    acknowledgedAnonymous = "Acknowledged",
                    reopenedAnonymous = "Reopened",
                    commentedAnonymous = "Comment added",
                    acknowledgedByActor = { actor -> "Acknowledged by $actor" },
                    reopenedByActor = { actor -> "Reopened by $actor" },
                    commentedByActor = { actor -> "Comment by $actor" },
                ),
        )

    // ── Kind classification ───────────────────────────────────────────────────

    @Test
    fun fromRawMapsKnownKindsAndFoldsUnknownToOther() {
        assertEquals(AlertTimelineKind.Created, AlertTimelineKind.fromRaw("created"))
        assertEquals(AlertTimelineKind.Acknowledged, AlertTimelineKind.fromRaw("acknowledged"))
        assertEquals(AlertTimelineKind.Reopened, AlertTimelineKind.fromRaw("reopened"))
        assertEquals(AlertTimelineKind.Commented, AlertTimelineKind.fromRaw("commented"))
        assertEquals(AlertTimelineKind.Other, AlertTimelineKind.fromRaw("snoozed"))
        assertEquals(AlertTimelineKind.Other, AlertTimelineKind.fromRaw(""))
    }

    // ── Title selection (web defaultTitleWithActor / defaultTitleAnonymous) ─────

    @Test
    fun createdAlwaysReadsAlertCreatedRegardlessOfActor() {
        assertEquals("Alert created", AlertDetailTimelineProjection.titleFor("created", "Atul", strings))
        assertEquals("Alert created", AlertDetailTimelineProjection.titleFor("created", null, strings))
    }

    @Test
    fun namedActorPicksInterpolatedTitle() {
        assertEquals("Acknowledged by Atul", AlertDetailTimelineProjection.titleFor("acknowledged", "Atul", strings))
        assertEquals("Reopened by Sam", AlertDetailTimelineProjection.titleFor("reopened", "Sam", strings))
        assertEquals("Comment by Lee", AlertDetailTimelineProjection.titleFor("commented", "Lee", strings))
    }

    @Test
    fun missingOrBlankActorPicksAnonymousTitle() {
        assertEquals("Acknowledged", AlertDetailTimelineProjection.titleFor("acknowledged", null, strings))
        assertEquals("Reopened", AlertDetailTimelineProjection.titleFor("reopened", "", strings))
        assertEquals("Comment added", AlertDetailTimelineProjection.titleFor("commented", "   ", strings))
    }

    @Test
    fun unknownKindFallsBackToRawKindString() {
        assertEquals("snoozed", AlertDetailTimelineProjection.titleFor("snoozed", "Atul", strings))
        assertEquals("escalated", AlertDetailTimelineProjection.titleFor("escalated", null, strings))
    }

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectReturnsNoRowsForNullOrEmptyEvents() {
        assertTrue(AlertDetailTimelineProjection.project(null, strings) { it }.isEmpty())
        assertTrue(AlertDetailTimelineProjection.project(emptyList(), strings) { it }.isEmpty())
    }

    @Test
    fun projectMapsEventsPreservingOrderTitleSubtitleTimeAndKind() {
        val events =
            listOf(
                AlertEvent(id = 0, occurredAt = "iso-created", actor = null, kind = "created", note = null),
                AlertEvent(id = 1, occurredAt = "iso-ack", actor = "Atul", kind = "acknowledged", note = "looks fine"),
                AlertEvent(id = 2, occurredAt = "iso-comment", actor = null, kind = "commented", note = null),
            )

        val rows = AlertDetailTimelineProjection.project(events, strings) { iso -> "T($iso)" }

        assertEquals(3, rows.size)

        assertEquals("Alert created", rows[0].title)
        assertEquals(null, rows[0].subtitle)
        assertEquals("T(iso-created)", rows[0].time)
        assertEquals(AlertTimelineKind.Created, rows[0].kind)

        assertEquals("Acknowledged by Atul", rows[1].title)
        assertEquals("looks fine", rows[1].subtitle)
        assertEquals("T(iso-ack)", rows[1].time)
        assertEquals(AlertTimelineKind.Acknowledged, rows[1].kind)

        assertEquals("Comment added", rows[2].title)
        assertEquals(AlertTimelineKind.Commented, rows[2].kind)
    }

    // ── Timestamp formatting (web formatDateTime parity + invalid-date guard) ─────

    @Test
    fun formatRendersRfc3339InstantInGivenZoneAndLocale() {
        val text = AlertDetailTimeFormatting.format("2026-04-04T14:30:00Z", ZoneOffset.UTC, Locale.US)
        assertTrue("expected medium date, was: $text", text.contains("Apr 4, 2026"))
        assertTrue("expected short time, was: $text", text.contains("2:30"))
    }

    @Test
    fun formatAcceptsOffsetAndZonelessLocalDateTime() {
        val sameInstant = "Apr 4, 2026"
        assertTrue(AlertDetailTimeFormatting.format("2026-04-04T14:30:00+00:00", ZoneOffset.UTC, Locale.US).contains(sameInstant))
        assertTrue(AlertDetailTimeFormatting.format("2026-04-04T14:30:00", ZoneOffset.UTC, Locale.US).contains(sameInstant))
    }

    @Test
    fun formatReturnsEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, AlertDetailTimeFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, AlertDetailTimeFormatting.format("   ", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, AlertDetailTimeFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }
}
