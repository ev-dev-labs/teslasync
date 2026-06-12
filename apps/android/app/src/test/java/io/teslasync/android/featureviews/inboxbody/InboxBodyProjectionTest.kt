package io.teslasync.android.featureviews.inboxbody

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the InboxBody surface's pure logic — the native analogue of the web component's
 * data derivations (web/src/features/notifications/components/InboxBody.tsx): the "Today" / "Yesterday" / dated
 * day bucketing (web `groupByDay`), the unread tally, the master select-all tri-state (web
 * `useBulkSelection.masterState`), the auto-mark-read-on-open id set, the severity-filter sanitization (web
 * `SEVERITY_VALUES.includes`), and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class InboxBodyProjectionTest {
    private val zone: ZoneId = ZoneId.of("UTC")
    private val now: Long = Instant.parse("2025-01-15T12:00:00Z").toEpochMilli()

    private fun row(
        id: Long,
        instant: String,
        read: Boolean = false,
        archived: Boolean = false,
    ): InboxNotification =
        InboxNotification(
            id = id,
            title = "title-$id",
            message = "message-$id",
            severity = "info",
            createdAtMillis = Instant.parse(instant).toEpochMilli(),
            isRead = read,
            isArchived = archived,
        )

    // ── groupByDay (web groupByDay parity) ──────────────────────────────────────────

    @Test
    fun groupByDayBucketsTodayYesterdayAndDatedPreservingOrder() {
        val rows =
            listOf(
                row(1, "2025-01-15T09:00:00Z"),
                row(2, "2025-01-15T08:00:00Z"),
                row(3, "2025-01-14T23:00:00Z"),
                row(4, "2025-01-10T10:00:00Z"),
            )

        val buckets = InboxBodyProjection.groupByDay(rows, now, zone, Locale.US)

        assertEquals(3, buckets.size)
        assertEquals(DayLabel.Today, buckets[0].label)
        assertEquals(listOf(1L, 2L), buckets[0].rows.map { it.id })
        assertEquals(DayLabel.Yesterday, buckets[1].label)
        assertEquals(listOf(3L), buckets[1].rows.map { it.id })
        assertEquals(DayLabel.Dated("Friday, Jan 10, 2025"), buckets[2].label)
        assertEquals(listOf(4L), buckets[2].rows.map { it.id })
    }

    @Test
    fun groupByDayStartsNewBucketWhenDayLabelChangesEvenIfDayRepeats() {
        val rows =
            listOf(
                row(1, "2025-01-15T09:00:00Z"),
                row(2, "2025-01-14T09:00:00Z"),
                row(3, "2025-01-15T07:00:00Z"),
            )

        val buckets = InboxBodyProjection.groupByDay(rows, now, zone, Locale.US)

        assertEquals(3, buckets.size)
        assertEquals(DayLabel.Today, buckets[0].label)
        assertEquals(DayLabel.Yesterday, buckets[1].label)
        assertEquals(DayLabel.Today, buckets[2].label)
        assertEquals(listOf(1L, 2L, 3L), buckets.flatMap { bucket -> bucket.rows.map { it.id } })
    }

    @Test
    fun groupByDayReturnsEmptyForNoRows() {
        assertTrue(InboxBodyProjection.groupByDay(emptyList(), now, zone, Locale.US).isEmpty())
    }

    // ── unreadCount (web rows.reduce tally) ─────────────────────────────────────────

    @Test
    fun unreadCountTalliesOnlyUnreadRows() {
        val rows =
            listOf(
                row(1, "2025-01-15T09:00:00Z", read = false),
                row(2, "2025-01-15T08:00:00Z", read = true),
                row(3, "2025-01-15T07:00:00Z", read = false),
            )

        assertEquals(2, InboxBodyProjection.unreadCount(rows))
        assertEquals(0, InboxBodyProjection.unreadCount(emptyList()))
    }

    // ── selectionState (web masterState) ────────────────────────────────────────────

    @Test
    fun selectionStateReflectsNoneSomeAndAll() {
        val visible = listOf(1L, 2L, 3L)

        assertEquals(SelectionState.None, InboxBodyProjection.selectionState(visible, emptySet()))
        assertEquals(SelectionState.Some, InboxBodyProjection.selectionState(visible, setOf(1L)))
        assertEquals(SelectionState.All, InboxBodyProjection.selectionState(visible, setOf(1L, 2L, 3L)))
        // Extra non-visible selections still count as "all visible selected".
        assertEquals(SelectionState.All, InboxBodyProjection.selectionState(visible, setOf(1L, 2L, 3L, 9L)))
        assertEquals(SelectionState.None, InboxBodyProjection.selectionState(emptyList(), setOf(1L)))
    }

    // ── autoMarkReadIds (web auto-mark-on-open effect) ──────────────────────────────

    @Test
    fun autoMarkReadIdsReturnsUnreadIdsOnlyOnFlatInbox() {
        val rows =
            listOf(
                row(1, "2025-01-15T09:00:00Z", read = false),
                row(2, "2025-01-15T08:00:00Z", read = true),
                row(3, "2025-01-15T07:00:00Z", read = false),
            )

        assertEquals(
            listOf(1L, 3L),
            InboxBodyProjection.autoMarkReadIds(rows, archived = false, grouped = false, markOnOpen = true),
        )
        assertTrue(InboxBodyProjection.autoMarkReadIds(rows, archived = true, grouped = false, markOnOpen = true).isEmpty())
        assertTrue(InboxBodyProjection.autoMarkReadIds(rows, archived = false, grouped = true, markOnOpen = true).isEmpty())
        assertTrue(InboxBodyProjection.autoMarkReadIds(rows, archived = false, grouped = false, markOnOpen = false).isEmpty())
    }

    // ── sanitizeSeverities (web SEVERITY_VALUES.includes guard) ──────────────────────

    @Test
    fun sanitizeSeveritiesDropsUnknownDeduplicatesAndPreservesOrder() {
        val result =
            InboxBodyProjection.sanitizeSeverities(
                listOf("info", "warning", "critical", "bogus", "info"),
            )

        assertEquals(listOf(InboxSeverity.Info, InboxSeverity.Warn, InboxSeverity.Critical), result)
    }

    @Test
    fun severityFromWireMatchesAliasesCaseAndSpaceTolerantElseNull() {
        assertEquals(InboxSeverity.Info, InboxSeverity.fromWire("info"))
        assertEquals(InboxSeverity.Warn, InboxSeverity.fromWire("  WARNING "))
        assertEquals(InboxSeverity.Critical, InboxSeverity.fromWire("error"))
        assertEquals(InboxSeverity.Critical, InboxSeverity.fromWire("fatal"))
        assertNull(InboxSeverity.fromWire("offline"))
        assertNull(InboxSeverity.fromWire(""))
    }

    // ── Diagnostics + registration (P1/S11) ─────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordInboxBodyOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "InboxBody"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("inbox-body", InboxBodyRegistration.ID)
        assertEquals("InboxBody", InboxBodyRegistration.SLUG)
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
