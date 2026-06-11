package io.teslasync.android.featureviews.eventhistorytable

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the EventHistoryTable pure model — the native port of the web component's per-row
 * `render` callbacks and the shared `./helpers.ts` predicates it leans on (doorClosed / parseWindowState /
 * allWindowsClosed / windowSummary), the `string | boolean | null` truthiness the JSX badges rely on, the
 * `createdAt` sort, the timestamp formatting, and the PII-safe `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/admin/components/security-access/EventHistoryTable.tsx + ./helpers.ts).
 */
class EventHistoryTableModelTest {
    private val strings =
        EventHistoryStrings(
            locked = "LOCKED",
            unlocked = "UNLOCKED",
            on = "ON",
            off = "OFF",
            closed = "CLOSED",
        )

    private fun str(value: String): SignalValue = SignalValue.StringValue(value)

    // Core builder (5 params, all windows Absent). Tests needing specific window positions use [windowsEvent];
    // the one test needing closed windows alongside other fields builds the SecurityEvent inline.
    private fun event(
        id: String = "1",
        createdAt: String = "2026-04-04T12:00:00Z",
        locked: Boolean? = null,
        sentryMode: SignalValue = SignalValue.Absent,
        doorState: SignalValue = SignalValue.Absent,
    ): SecurityEvent =
        SecurityEvent(
            id = id,
            createdAt = createdAt,
            locked = locked,
            sentryMode = sentryMode,
            doorState = doorState,
            fdWindow = SignalValue.Absent,
            fpWindow = SignalValue.Absent,
            rdWindow = SignalValue.Absent,
            rpWindow = SignalValue.Absent,
        )

    private fun windowsEvent(
        fd: String,
        fp: String,
        rd: String,
        rp: String,
    ): SecurityEvent =
        SecurityEvent(
            id = "1",
            createdAt = "2026-04-04T12:00:00Z",
            locked = null,
            sentryMode = SignalValue.Absent,
            doorState = SignalValue.Absent,
            fdWindow = str(fd),
            fpWindow = str(fp),
            rdWindow = str(rd),
            rpWindow = str(rp),
        )

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── asNonEmptyString (web typeGuards.asNonEmptyString) ──────────────────────────────────────────

    @Test
    fun asNonEmptyStringReturnsOnlyNonEmptyStrings() {
        assertEquals("Open", str("Open").asNonEmptyString())
        assertNull(str("").asNonEmptyString())
        assertNull(SignalValue.BoolValue(true).asNonEmptyString())
        assertNull(SignalValue.Absent.asNonEmptyString())
    }

    // ── isTruthy (web `row.sentryMode ?` JS truthiness) ─────────────────────────────────────────────

    @Test
    fun isTruthyMatchesJavaScriptSemantics() {
        assertTrue(SignalValue.BoolValue(true).isTruthy())
        assertFalse(SignalValue.BoolValue(false).isTruthy())
        // A non-empty string is truthy in JS even when its text reads "Off".
        assertTrue(str("SentryModeStateOff").isTruthy())
        assertFalse(str("").isTruthy())
        assertFalse(SignalValue.Absent.isTruthy())
    }

    // ── parseWindowState (web helpers.parseWindowState) ─────────────────────────────────────────────

    @Test
    fun parseWindowStateClassifiesEachToken() {
        assertEquals(WindowState.Closed, parseWindowState(str("Closed")))
        assertEquals(WindowState.Closed, parseWindowState(str("0")))
        assertEquals(WindowState.Venting, parseWindowState(str("Venting")))
        assertEquals(WindowState.Open, parseWindowState(str("Open")))
        assertEquals(WindowState.Unknown, parseWindowState(str("")))
        assertEquals(WindowState.Unknown, parseWindowState(SignalValue.Absent))
        // A boolean window value has no string form, so it is Unknown (never coerced to "false"/"true").
        assertEquals(WindowState.Unknown, parseWindowState(SignalValue.BoolValue(false)))
    }

    // ── doorClosed (web helpers.doorClosed) ─────────────────────────────────────────────────────────

    @Test
    fun doorClosedHandlesAbsentAndBoolean() {
        assertTrue(doorClosed(SignalValue.Absent))
        assertTrue(doorClosed(SignalValue.BoolValue(false)))
        assertFalse(doorClosed(SignalValue.BoolValue(true)))
    }

    @Test
    fun doorClosedHandlesClosedStringTokens() {
        assertTrue(doorClosed(str("Closed")))
        assertTrue(doorClosed(str("ClosedAll")))
        assertTrue(doorClosed(str("0")))
        assertTrue(doorClosed(str("false")))
        assertTrue(doorClosed(str("")))
        assertTrue(doorClosed(str("   ")))
        assertFalse(doorClosed(str("Front Left Open")))
    }

    @Test
    fun doorClosedParsesJsonObjectStrings() {
        assertTrue(doorClosed(str("""{"df":false,"pf":false,"dr":null}""")))
        assertFalse(doorClosed(str("""{"df":true,"pf":false}""")))
        // A JSON string "false" is not strictly === false, so the object is treated as open (web parity).
        assertFalse(doorClosed(str("""{"df":"false"}""")))
        // Malformed object string falls through to "open" (web catch arm).
        assertFalse(doorClosed(str("{not valid json")))
    }

    // ── allWindowsClosed + windowSummary (web helpers) ──────────────────────────────────────────────

    @Test
    fun allWindowsClosedRequiresEveryWindowClosed() {
        assertTrue(allWindowsClosed(windowsEvent("Closed", "0", "Closed", "Closed")))
        assertFalse(allWindowsClosed(windowsEvent("Closed", "Open", "Closed", "Closed")))
        // Absent windows are Unknown, not Closed, so the set is not "all closed".
        assertFalse(allWindowsClosed(event()))
    }

    @Test
    fun windowSummaryReportsAllClosedOrOpenCount() {
        assertEquals("All Closed", windowSummary(windowsEvent("Closed", "Closed", "Closed", "Closed")))
        assertEquals("2 Open/Venting", windowSummary(windowsEvent("Open", "Closed", "Venting", "Closed")))
        assertEquals("1 Open/Venting", windowSummary(windowsEvent("Open", "Closed", "Closed", "Closed")))
    }

    // ── doorLabel (web Doors cell ternary) ──────────────────────────────────────────────────────────

    @Test
    fun doorLabelPrefersRawStringThenClosedLabelThenEmDash() {
        assertEquals("Front Left Open", doorLabel(event(doorState = str("Front Left Open")), strings.closed))
        assertEquals("CLOSED", doorLabel(event(doorState = SignalValue.Absent), strings.closed))
        assertEquals("CLOSED", doorLabel(event(doorState = SignalValue.BoolValue(false)), strings.closed))
        // An open boolean door has no raw string and is not closed → the em dash.
        assertEquals("\u2014", doorLabel(event(doorState = SignalValue.BoolValue(true)), strings.closed))
    }

    // ── EventHistoryProjection.project (web per-row render callbacks) ────────────────────────────────

    @Test
    fun projectMapsLockSentryDoorAndWindowCells() {
        val source =
            SecurityEvent(
                id = "e1",
                createdAt = "2026-04-04T12:00:00Z",
                locked = true,
                sentryMode = str("On"),
                doorState = str("Closed"),
                fdWindow = str("Closed"),
                fpWindow = str("Closed"),
                rdWindow = str("Closed"),
                rpWindow = str("Closed"),
            )
        val row =
            EventHistoryProjection
                .project(events = listOf(source), strings = strings, formatTime = { iso -> "T:$iso" })
                .single()

        assertEquals("e1", row.id)
        assertEquals("T:2026-04-04T12:00:00Z", row.time)
        assertEquals(BadgeCell("LOCKED", BadgeTone.Success), row.lock)
        assertEquals(BadgeCell("ON", BadgeTone.Success), row.sentry)
        assertEquals("Closed", row.door.text)
        assertTrue(row.door.closed)
        assertEquals("All Closed", row.window.text)
    }

    @Test
    fun projectUsesNegativeTonesForUnlockedAndSentryOff() {
        val row =
            EventHistoryProjection
                .project(
                    events = listOf(event(locked = false, sentryMode = SignalValue.BoolValue(false))),
                    strings = strings,
                    formatTime = { "T" },
                ).single()

        assertEquals(BadgeCell("UNLOCKED", BadgeTone.Danger), row.lock)
        assertEquals(BadgeCell("OFF", BadgeTone.Neutral), row.sentry)
    }

    @Test
    fun projectTreatsNullLockedAsUnlocked() {
        val row =
            EventHistoryProjection
                .project(listOf(event(locked = null)), strings) { "T" }
                .single()
        assertEquals(BadgeCell("UNLOCKED", BadgeTone.Danger), row.lock)
    }

    // ── sortEvents (web createdAt column sort) ───────────────────────────────────────────────────────

    private val oldest = event(id = "old", createdAt = "2026-04-04T10:00:00Z")
    private val middle = event(id = "mid", createdAt = "2026-04-04T12:00:00Z")
    private val newest = event(id = "new", createdAt = "2026-04-04T14:00:00Z")
    private val unsorted = listOf(middle, newest, oldest)

    @Test
    fun sortNonTimeColumnPreservesOrder() {
        assertEquals(unsorted, sortEvents(unsorted, SortState("locked", SortDirection.Asc)))
        assertEquals(unsorted, sortEvents(unsorted, SortState(null, SortDirection.Asc)))
    }

    @Test
    fun sortByTimeAscendingOrdersOldestFirst() {
        val sorted = sortEvents(unsorted, SortState(SORT_KEY_TIME, SortDirection.Asc))
        assertEquals(listOf("old", "mid", "new"), sorted.map { it.id })
    }

    @Test
    fun sortByTimeDescendingOrdersNewestFirst() {
        val sorted = sortEvents(unsorted, SortState(SORT_KEY_TIME, SortDirection.Desc))
        assertEquals(listOf("new", "mid", "old"), sorted.map { it.id })
    }

    @Test
    fun sortByTimeSinksUnparseableStamps() {
        val bad = event(id = "bad", createdAt = "not-a-date")
        val ascending = sortEvents(listOf(newest, bad, oldest), SortState(SORT_KEY_TIME, SortDirection.Asc))
        // Unparseable stamps fold to Long.MIN_VALUE → first ascending, last descending.
        assertEquals("bad", ascending.first().id)
        val descending = sortEvents(listOf(newest, bad, oldest), SortState(SORT_KEY_TIME, SortDirection.Desc))
        assertEquals("bad", descending.last().id)
    }

    // ── EventHistoryTimeFormatting / parseEpochMillis ───────────────────────────────────────────────

    @Test
    fun formatRendersAbsoluteTimeAndEmDashForBadInput() {
        val formatted = EventHistoryTimeFormatting.format("2026-04-04T14:30:00Z", ZoneOffset.UTC, Locale.US)
        assertTrue(formatted.contains("2026"))
        assertEquals("\u2014", EventHistoryTimeFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals("\u2014", EventHistoryTimeFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun parseEpochMillisDecodesIsoAndRejectsBlanks() {
        // 2021-01-01T00:00:00Z is the well-known epoch 1_609_459_200 s.
        assertEquals(1_609_459_200_000L, parseEpochMillis("2021-01-01T00:00:00Z"))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("nope"))
    }

    // ── Diagnostics (P1/S11 view.opened) ─────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordEventHistoryTableOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "EventHistoryTable"), opened.single().second)
    }
}
