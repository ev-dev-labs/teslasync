package io.teslasync.android.featureviews.entriestable

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the EntriesTable's pure logic — the native analogue of everything the web
 * component derives before returning JSX (web/src/features/admin/components/dlq-inspector/EntriesTable.tsx):
 * the `useSortToggle` comparator switch (arrived/reason/VIN/size, with the null-VIN `?? ''` and the
 * unknown-key no-op), the per-cell formatting (TimeStamp absolute, fmtInt, formatBytes, the `||`/`??`
 * em-dash fallbacks), the tolerant ISO-8601 parsing with its em-dash guard, the page-size configuration,
 * and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class EntriesTableProjectionTest {
    private val rowA =
        DLQEntrySummary(
            id = 1,
            arrivedAt = "2026-04-04T14:30:00Z",
            parsedReason = "alpha",
            parsedVin = "VINB",
            parsedSourceTopic = "topic/b",
            parsedRedeliveries = 3,
            replayable = true,
            rawPayloadSize = 300,
        )
    private val rowB =
        DLQEntrySummary(
            id = 2,
            arrivedAt = "2026-04-04T10:00:00Z",
            parsedReason = "beta",
            parsedVin = "VINA",
            parsedSourceTopic = null,
            parsedRedeliveries = null,
            replayable = false,
            rawPayloadSize = 100,
        )
    private val rowC =
        DLQEntrySummary(
            id = 3,
            arrivedAt = "2026-04-04T12:00:00Z",
            parsedReason = "charlie",
            parsedVin = null,
            parsedSourceTopic = "topic/c",
            parsedRedeliveries = 0,
            replayable = true,
            rawPayloadSize = 200,
        )
    private val rows = listOf(rowA, rowB, rowC)

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

    private fun ids(result: List<DLQEntrySummary>): List<Long> = result.map { it.id }

    // ── Sorting (web useSortToggle comparator switch) ─────────────────────────────────────────────────

    @Test
    fun sortByArrivedAtAscendingThenDescending() {
        assertEquals(listOf(2L, 3L, 1L), ids(EntriesTableProjection.sortRows(rows, EntriesColumnKey.ARRIVED, descending = false)))
        assertEquals(listOf(1L, 3L, 2L), ids(EntriesTableProjection.sortRows(rows, EntriesColumnKey.ARRIVED, descending = true)))
    }

    @Test
    fun sortByReasonLexicographically() {
        assertEquals(listOf(1L, 2L, 3L), ids(EntriesTableProjection.sortRows(rows, EntriesColumnKey.REASON, descending = false)))
        assertEquals(listOf(3L, 2L, 1L), ids(EntriesTableProjection.sortRows(rows, EntriesColumnKey.REASON, descending = true)))
    }

    @Test
    fun sortByVinTreatsNullAsEmptyString() {
        // rowC has a null VIN → compares as "" → sorts first ascending (web `?? ''`).
        assertEquals(listOf(3L, 2L, 1L), ids(EntriesTableProjection.sortRows(rows, EntriesColumnKey.VIN, descending = false)))
    }

    @Test
    fun sortByPayloadSizeNumerically() {
        assertEquals(listOf(2L, 3L, 1L), ids(EntriesTableProjection.sortRows(rows, EntriesColumnKey.PAYLOAD_SIZE, descending = false)))
        assertEquals(listOf(1L, 3L, 2L), ids(EntriesTableProjection.sortRows(rows, EntriesColumnKey.PAYLOAD_SIZE, descending = true)))
    }

    @Test
    fun unknownOrNullSortKeyPreservesOriginalOrder() {
        assertEquals(listOf(1L, 2L, 3L), ids(EntriesTableProjection.sortRows(rows, "parsed_source_topic", descending = true)))
        assertEquals(listOf(1L, 2L, 3L), ids(EntriesTableProjection.sortRows(rows, null, descending = false)))
    }

    @Test
    fun sortIsStableForTiesOnDescending() {
        // Two rows share a payload size; a descending sort keeps their original relative order (web cmp*dir).
        val tie1 = rowA.copy(id = 10, rawPayloadSize = 500)
        val tie2 = rowB.copy(id = 11, rawPayloadSize = 500)
        val result = EntriesTableProjection.sortRows(listOf(tie1, tie2), EntriesColumnKey.PAYLOAD_SIZE, descending = true)
        assertEquals(listOf(10L, 11L), ids(result))
    }

    // ── Cell formatting (web render callbacks) ────────────────────────────────────────────────────────

    @Test
    fun cellTextProjectsAllColumnsWithFallbacks() {
        val cells = EntriesTableProjection.cellTextOf(rowB.copy(parsedVin = null)) { iso -> "T($iso)" }
        assertEquals("T(2026-04-04T10:00:00Z)", cells.arrived)
        assertEquals("beta", cells.reason)
        assertEquals(EM_DASH, cells.vin) // null VIN → em-dash (web `?? '—'`)
        assertEquals(EM_DASH, cells.sourceTopic) // null topic → em-dash
        assertEquals(EM_DASH, cells.redeliveries) // null redeliveries → em-dash (web `!= null ? … : '—'`)
        assertEquals("100 B", cells.payload)
    }

    @Test
    fun cellTextEmptyReasonFallsBackToEmDashButZeroRedeliveriesIsShown() {
        val cells = EntriesTableProjection.cellTextOf(rowC.copy(parsedReason = "")) { it }
        assertEquals(EM_DASH, cells.reason) // empty string reason → em-dash (web `||`)
        assertEquals("0", cells.redeliveries) // 0 is present (not null) → fmtInt(0)
    }

    @Test
    fun cellTextEmptyVinIsKeptDistinctFromNullVin() {
        // web vin uses `?? '—'`, so an empty-string VIN renders as "" (not the em-dash).
        val cells = EntriesTableProjection.cellTextOf(rowA.copy(parsedVin = "")) { it }
        assertEquals("", cells.vin)
    }

    // ── formatBytes (web formatBytes parity) ──────────────────────────────────────────────────────────

    @Test
    fun formatBytesMatchesWebThresholds() {
        assertEquals(EM_DASH, EntriesTableProjection.formatBytes(-1))
        assertEquals("0 B", EntriesTableProjection.formatBytes(0))
        assertEquals("512 B", EntriesTableProjection.formatBytes(512))
        assertEquals("1023 B", EntriesTableProjection.formatBytes(1023))
        assertEquals("1.0 KB", EntriesTableProjection.formatBytes(1024))
        assertEquals("1.5 KB", EntriesTableProjection.formatBytes(1536))
        assertEquals("1.0 MB", EntriesTableProjection.formatBytes(1024 * 1024))
        assertEquals("2.1 MB", EntriesTableProjection.formatBytes(2_200_000))
    }

    // ── fmtInt (web Intl.NumberFormat, 0 fraction digits) ─────────────────────────────────────────────

    @Test
    fun fmtIntGroupsThousands() {
        assertEquals("0", EntriesTableProjection.fmtInt(0))
        assertEquals("5", EntriesTableProjection.fmtInt(5))
        assertEquals("42", EntriesTableProjection.fmtInt(42))
        assertEquals("1,234", EntriesTableProjection.fmtInt(1234))
        assertEquals("1,000,000", EntriesTableProjection.fmtInt(1_000_000))
    }

    // ── Timestamp formatting (web TimeStamp absolute + Date.parse) ────────────────────────────────────

    @Test
    fun formatRendersAbsoluteMediumDateShortTime() {
        val text = EntriesTableTimeFormatting.format("2026-04-04T14:30:00Z", ZoneOffset.UTC, Locale.US)
        assertTrue("expected medium date, was: $text", text.contains("Apr 4, 2026"))
        assertTrue("expected short time, was: $text", text.contains("2:30"))
    }

    @Test
    fun formatAcceptsOffsetAndZonelessLocalDateTime() {
        val expected = "Apr 4, 2026"
        assertTrue(EntriesTableTimeFormatting.format("2026-04-04T14:30:00+00:00", ZoneOffset.UTC, Locale.US).contains(expected))
        assertTrue(EntriesTableTimeFormatting.format("2026-04-04T14:30:00", ZoneOffset.UTC, Locale.US).contains(expected))
    }

    @Test
    fun formatReturnsEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, EntriesTableTimeFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, EntriesTableTimeFormatting.format("   ", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, EntriesTableTimeFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun epochMillisParsesInstantAndGuardsUnparseable() {
        assertEquals(Instant.parse("2026-04-04T14:30:00Z").toEpochMilli(), EntriesTableTimeFormatting.epochMillis("2026-04-04T14:30:00Z"))
        assertNull(EntriesTableTimeFormatting.epochMillis("not-a-date"))
        assertNull(EntriesTableTimeFormatting.epochMillis(""))
    }

    // ── Pagination configuration (web pagination prop) ────────────────────────────────────────────────

    @Test
    fun pageSizeConfigurationMatchesWeb() {
        assertEquals(25, ENTRIES_DEFAULT_PAGE_SIZE)
        assertEquals(listOf(25, 50, 100), ENTRIES_PAGE_SIZE_OPTIONS)
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordEntriesTableOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "EntriesTable"), opened.single().second)
    }
}
