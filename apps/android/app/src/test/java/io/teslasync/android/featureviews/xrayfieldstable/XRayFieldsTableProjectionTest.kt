package io.teslasync.android.featureviews.xrayfieldstable

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the XRayFieldsTable's pure projection — the native port of the web component's
 * `(rows, loading)` render contract (web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx):
 * the `(rows, loading)` → lifecycle [UiPhase] adapter, the four-key sort ladder (`useSortToggle` + the
 * component's own comparator), the `formatValueKind` map (incl. the `kind {n}` fallback), the relative
 * `last_seen_at` bucketing (`<TimeStamp format="relative" />` → `formatRelative`), the grouped sample-count
 * formatting (`fmtInt`), and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate; no Compose, no device.
 */
class XRayFieldsTableProjectionTest {
    private fun stat(
        field: String = "FieldA",
        sampleCount: Long = 1,
        lastSeenAt: String = "2026-06-11T12:00:00Z",
        valueKind: Int = 0,
    ): IngestXRayFieldStat = IngestXRayFieldStat(field, sampleCount, lastSeenAt, valueKind)

    private val now: Long = Instant.parse("2026-06-11T14:22:00Z").toEpochMilli()

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

    // ── (rows, loading) → lifecycle UiState adapter (web's empty-vs-table branch) ─────────────────────

    @Test
    fun contentWhenRowsPresent() {
        val rows = listOf(stat(field = "A"), stat(field = "B"))
        val state = XRayFieldsTableProjection.projectUiState(rows, loading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(rows, state.data)
        assertFalse(state.refreshing)
    }

    @Test
    fun contentWhenRowsPresentIgnoresLoading() {
        // Web parity: once rows exist the table is shown; `loading` has no visible effect on the surface.
        val rows = listOf(stat(field = "A"))
        val state = XRayFieldsTableProjection.projectUiState(rows, loading = true)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(rows, state.data)
    }

    @Test
    fun loadingWhenEmptyAndLoading() {
        val state = XRayFieldsTableProjection.projectUiState(emptyList(), loading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun emptyWhenEmptyAndNotLoading() {
        val state = XRayFieldsTableProjection.projectUiState(emptyList(), loading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    // ── Sort ladder (web `useSortToggle('sample_count','desc')` + the component comparator) ────────────

    @Test
    fun sortsBySampleCountDescendingByDefault() {
        val rows = listOf(stat(field = "low", sampleCount = 5), stat(field = "high", sampleCount = 900))
        val sorted = XRayFieldsTableProjection.sortRows(rows, SortState(XRAY_COL_SAMPLE_COUNT, SortDirection.Desc))
        assertEquals(listOf("high", "low"), sorted.map { it.field })
    }

    @Test
    fun sortsBySampleCountAscending() {
        val rows = listOf(stat(field = "high", sampleCount = 900), stat(field = "low", sampleCount = 5))
        val sorted = XRayFieldsTableProjection.sortRows(rows, SortState(XRAY_COL_SAMPLE_COUNT, SortDirection.Asc))
        assertEquals(listOf("low", "high"), sorted.map { it.field })
    }

    @Test
    fun sortsByFieldText() {
        val rows = listOf(stat(field = "Zeta"), stat(field = "Alpha"), stat(field = "Mu"))
        val asc = XRayFieldsTableProjection.sortRows(rows, SortState(XRAY_COL_FIELD, SortDirection.Asc))
        assertEquals(listOf("Alpha", "Mu", "Zeta"), asc.map { it.field })
        val desc = XRayFieldsTableProjection.sortRows(rows, SortState(XRAY_COL_FIELD, SortDirection.Desc))
        assertEquals(listOf("Zeta", "Mu", "Alpha"), desc.map { it.field })
    }

    @Test
    fun sortsByLastSeenInstant() {
        val older = stat(field = "older", lastSeenAt = "2026-06-11T10:00:00Z")
        val newer = stat(field = "newer", lastSeenAt = "2026-06-11T14:00:00Z")
        val asc = XRayFieldsTableProjection.sortRows(listOf(newer, older), SortState(XRAY_COL_LAST_SEEN, SortDirection.Asc))
        assertEquals(listOf("older", "newer"), asc.map { it.field })
        val desc = XRayFieldsTableProjection.sortRows(listOf(older, newer), SortState(XRAY_COL_LAST_SEEN, SortDirection.Desc))
        assertEquals(listOf("newer", "older"), desc.map { it.field })
    }

    @Test
    fun sortsByValueKind() {
        val rows = listOf(stat(field = "loc", valueKind = 10), stat(field = "str", valueKind = 1))
        val asc = XRayFieldsTableProjection.sortRows(rows, SortState(XRAY_COL_VALUE_KIND, SortDirection.Asc))
        assertEquals(listOf("str", "loc"), asc.map { it.field })
    }

    @Test
    fun unknownSortKeyReturnsRowsUnchanged() {
        // Web parity: the comparator's `default: return 0` leaves the input order intact.
        val rows = listOf(stat(field = "B"), stat(field = "A"))
        val sorted = XRayFieldsTableProjection.sortRows(rows, SortState("nope", SortDirection.Asc))
        assertEquals(listOf("B", "A"), sorted.map { it.field })
    }

    // ── formatValueKind map + `kind {n}` fallback (web `formatValueKind`) ─────────────────────────────

    @Test
    fun formatValueKindMapsEveryKnownKind() {
        assertEquals("unknown", XRayFieldsTableProjection.formatValueKind(0))
        assertEquals("string", XRayFieldsTableProjection.formatValueKind(1))
        assertEquals("bool", XRayFieldsTableProjection.formatValueKind(2))
        assertEquals("int32", XRayFieldsTableProjection.formatValueKind(3))
        assertEquals("int64", XRayFieldsTableProjection.formatValueKind(4))
        assertEquals("float32", XRayFieldsTableProjection.formatValueKind(5))
        assertEquals("float64", XRayFieldsTableProjection.formatValueKind(6))
        assertEquals("enum", XRayFieldsTableProjection.formatValueKind(7))
        assertEquals("invalid", XRayFieldsTableProjection.formatValueKind(8))
        assertEquals("time", XRayFieldsTableProjection.formatValueKind(9))
        assertEquals("location", XRayFieldsTableProjection.formatValueKind(10))
    }

    @Test
    fun formatValueKindUnknownFallsBackToKindN() {
        assertEquals("kind 42", XRayFieldsTableProjection.formatValueKind(42))
        assertEquals("kind -1", XRayFieldsTableProjection.formatValueKind(-1))
    }

    // ── Relative last_seen bucketing (web `formatRelative` cutoffs) ───────────────────────────────────

    @Test
    fun lastSeenJustNowUnderOneMinute() {
        assertEquals(XRayLastSeen.JustNow, XRayFieldsTableProjection.lastSeenRelative("2026-06-11T14:21:30Z", now))
    }

    @Test
    fun lastSeenMinutes() {
        assertEquals(XRayLastSeen.Minutes(5), XRayFieldsTableProjection.lastSeenRelative("2026-06-11T14:17:00Z", now))
    }

    @Test
    fun lastSeenHours() {
        assertEquals(XRayLastSeen.Hours(2), XRayFieldsTableProjection.lastSeenRelative("2026-06-11T12:22:00Z", now))
    }

    @Test
    fun lastSeenDays() {
        assertEquals(XRayLastSeen.Days(2), XRayFieldsTableProjection.lastSeenRelative("2026-06-09T14:22:00Z", now))
    }

    @Test
    fun lastSeenAbsoluteBeyondAWeek() {
        val relative = XRayFieldsTableProjection.lastSeenRelative("2026-06-01T14:22:00Z", now)
        assertTrue("expected Absolute, got $relative", relative is XRayLastSeen.Absolute)
    }

    @Test
    fun lastSeenFutureFoldsToJustNow() {
        // Web parity: a negative diff makes `seconds < 60` true, so a clock-skewed stamp shows "just now".
        assertEquals(XRayLastSeen.JustNow, XRayFieldsTableProjection.lastSeenRelative("2026-06-11T14:25:00Z", now))
    }

    @Test
    fun lastSeenInvalidWhenBlankOrUnparseable() {
        assertEquals(XRayLastSeen.Invalid, XRayFieldsTableProjection.lastSeenRelative("", now))
        assertEquals(XRayLastSeen.Invalid, XRayFieldsTableProjection.lastSeenRelative("   ", now))
        assertEquals(XRayLastSeen.Invalid, XRayFieldsTableProjection.lastSeenRelative("not-a-timestamp", now))
    }

    @Test
    fun lastSeenParsesOffsetDateTime() {
        assertEquals(XRayLastSeen.Hours(1), XRayFieldsTableProjection.lastSeenRelative("2026-06-11T15:22:00+02:00", now))
    }

    @Test
    fun absoluteFormatRendersYearInZone() {
        val epoch = Instant.parse("2026-06-01T14:22:00Z").toEpochMilli()
        val formatted = XRayLastSeenFormatting.absolute(epoch, ZoneId.of("UTC"), Locale.US)
        assertTrue("expected a year in '$formatted'", formatted.contains("2026"))
        assertFalse("a valid timestamp must not fall back to the em dash", formatted == EM_DASH)
    }

    // ── Grouped sample-count formatting (web `fmtInt`) ────────────────────────────────────────────────

    @Test
    fun formatSampleCountGroupsThousands() {
        assertEquals("12,345", XRayFieldsTableProjection.formatSampleCount(12_345, Locale.US))
        assertEquals("0", XRayFieldsTableProjection.formatSampleCount(0, Locale.US))
    }

    @Test
    fun formatSampleCountClampsNegativeToZero() {
        assertEquals("0", XRayFieldsTableProjection.formatSampleCount(-5, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordXRayFieldsTableOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "XRayFieldsTable"), opened.single().second)
        assertEquals("XRayFieldsTable", XRAY_FIELDS_TABLE_SLUG)
    }
}
