package io.teslasync.android.featureviews.fsmtimelinechart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/**
 * Off-device verification of the FSM timeline chart's pure logic — the native analogue of the web
 * component's `useMemo` (web/src/features/system/components/FSMTimelineChart.tsx): the window → bucket-width
 * selection, the floor-aligned bucket layout across `[now - hours, now]`, the tolerant timestamp decode with
 * its `NaN`-miss drop, the sorted FSM-name series set (including names whose timestamp misses the window),
 * the per-bucket counting, the local `HH:mm` labels, the empty guard, and the PII-safe `view.opened`
 * diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class FSMTimelineChartProjectionTest {
    private companion object {
        val UTC: ZoneId = ZoneId.of("UTC")

        /** 2023-11-14T22:13:20Z — the fixed "now" the windowed tests bucket against. */
        const val NOW_MILLIS: Long = 1_700_000_000_000L

        const val TEN_MIN_MS: Long = 600_000L
        const val WINDOW_6H: Int = 6
        const val BUCKETS_IN_6H_AT_10MIN: Int = 37

        fun millisOf(iso: String): Long = Instant.parse(iso).toEpochMilli()
    }

    // ── bucketSizeMs (web hours <= 6 ? 10min : hours <= 24 ? 30min : 2h) ──────────

    @Test
    fun bucketSizeMsSelectsWidthByWindowWithTheWebBoundaries() {
        // ≤ 6 h → 10 min (including the web "all time" hours = 0 quirk).
        assertEquals(BUCKET_MS_10_MIN, FSMTimelineChartProjection.bucketSizeMs(0))
        assertEquals(BUCKET_MS_10_MIN, FSMTimelineChartProjection.bucketSizeMs(1))
        assertEquals(BUCKET_MS_10_MIN, FSMTimelineChartProjection.bucketSizeMs(BUCKET_THRESHOLD_6H))
        // (6, 24] → 30 min.
        assertEquals(BUCKET_MS_30_MIN, FSMTimelineChartProjection.bucketSizeMs(BUCKET_THRESHOLD_6H + 1))
        assertEquals(BUCKET_MS_30_MIN, FSMTimelineChartProjection.bucketSizeMs(BUCKET_THRESHOLD_24H))
        // > 24 h → 2 h.
        assertEquals(BUCKET_MS_2_HOUR, FSMTimelineChartProjection.bucketSizeMs(BUCKET_THRESHOLD_24H + 1))
        assertEquals(BUCKET_MS_2_HOUR, FSMTimelineChartProjection.bucketSizeMs(720))
        assertEquals(BUCKET_MS_2_HOUR, FSMTimelineChartProjection.bucketSizeMs(2160))
    }

    // ── bucketKeys (web for (ts=start; ts<=now; ts+=bucketMs) floor-align) ─────────

    @Test
    fun bucketKeysAreContiguousFloorAlignedAndAscending() {
        val keys = FSMTimelineChartProjection.bucketKeys(startMillis = 0, nowMillis = 100, bucketMs = 10)

        assertEquals(listOf(0L, 10L, 20L, 30L, 40L, 50L, 60L, 70L, 80L, 90L, 100L), keys)
    }

    @Test
    fun bucketKeysFloorAlignAnUnalignedStart() {
        val keys = FSMTimelineChartProjection.bucketKeys(startMillis = 5, nowMillis = 35, bucketMs = 10)

        // 5,15,25,35 floor-align to 0,10,20,30 — the web `Math.floor(ts / bucketMs) * bucketMs`.
        assertEquals(listOf(0L, 10L, 20L, 30L), keys)
    }

    // ── parseMillis (web new Date(tr.ts).getTime() tolerance) ─────────────────────

    @Test
    fun parseMillisAcceptsInstantOffsetAndZonelessFormsAndRejectsGarbage() {
        val expected = millisOf("2023-11-14T20:00:00Z")
        // RFC-3339 instant.
        assertEquals(expected, FSMTimelineChartProjection.parseMillis("2023-11-14T20:00:00Z"))
        // Offset date-time normalizes to the same instant (22:00+02:00 == 20:00Z).
        assertEquals(expected, FSMTimelineChartProjection.parseMillis("2023-11-14T22:00:00+02:00"))
        // Zoneless local date-time treated as UTC.
        assertEquals(expected, FSMTimelineChartProjection.parseMillis("2023-11-14T20:00:00"))
        // Blank / unparseable → null (the web NaN miss).
        assertNull(FSMTimelineChartProjection.parseMillis(""))
        assertNull(FSMTimelineChartProjection.parseMillis("   "))
        assertNull(FSMTimelineChartProjection.parseMillis("not-a-date"))
    }

    // ── formatBucketLabel (web getHours()/getMinutes() local HH:mm) ───────────────

    @Test
    fun formatBucketLabelRendersLocalHourMinuteInTheGivenZone() {
        val instant = millisOf("2023-11-14T20:30:00Z")

        assertEquals("20:30", FSMTimelineChartProjection.formatBucketLabel(instant, UTC))
        // The same instant renders in the supplied zone (EST = UTC-5 on 2023-11-14).
        assertEquals("15:30", FSMTimelineChartProjection.formatBucketLabel(instant, ZoneId.of("America/New_York")))
    }

    // ── project (web useMemo: buckets + fsmTypes) ─────────────────────────────────

    @Test
    fun projectReturnsEmptyForNoTransitions() {
        val result = FSMTimelineChartProjection.project(emptyList(), WINDOW_6H, NOW_MILLIS, UTC)

        assertTrue(result.isEmpty)
        assertTrue(result.fsmTypes.isEmpty())
        assertTrue(result.series.isEmpty())
        assertTrue(result.xLabels.isEmpty())
    }

    @Test
    fun projectBucketsCountsByFsmNameDropsOutOfWindowAndInvalidButKeepsTheirTypes() {
        val transitions =
            listOf(
                FSMTransitionPoint(ts = "2023-11-14T20:00:00Z", fsmName = "vehicle"),
                FSMTransitionPoint(ts = "2023-11-14T20:05:00Z", fsmName = "vehicle"),
                FSMTransitionPoint(ts = "2023-11-14T21:00:00Z", fsmName = "telemetry_connection"),
                // Far before the 6-hour window → dropped from the counts (web `if (bucket)` miss).
                FSMTransitionPoint(ts = "2000-01-01T00:00:00Z", fsmName = "vehicle"),
                // Unparseable timestamp → dropped from counts, but its FSM name still seeds the series set.
                FSMTransitionPoint(ts = "not-a-date", fsmName = "drive"),
            )

        val result = FSMTimelineChartProjection.project(transitions, WINDOW_6H, NOW_MILLIS, UTC)

        assertFalse(result.isEmpty)
        // Sorted, de-duplicated names — including "drive" (invalid ts) and "vehicle" (also out-of-window).
        assertEquals(listOf("drive", "telemetry_connection", "vehicle"), result.fsmTypes)
        assertEquals(BUCKETS_IN_6H_AT_10MIN, result.xLabels.size)
        assertEquals(3, result.series.size)
        assertTrue(result.series.all { it.values.size == result.xLabels.size })
        // Only the three in-window, parseable transitions are counted.
        assertEquals(3.0, result.series.sumOf { it.values.sum() }, 0.0)
        assertEquals(2.0, seriesSum(result, "vehicle"), 0.0)
        assertEquals(1.0, seriesSum(result, "telemetry_connection"), 0.0)
        assertEquals(0.0, seriesSum(result, "drive"), 0.0)
    }

    @Test
    fun projectRendersAllZeroSeriesWhenEveryTransitionMissesTheWindow() {
        // Non-empty input but every timestamp is outside the window: the web still lays out buckets and
        // renders the (all-zero) chart rather than the empty state — only `transitions.length === 0` is empty.
        val transitions =
            listOf(
                FSMTransitionPoint(ts = "1999-01-01T00:00:00Z", fsmName = "vehicle"),
                FSMTransitionPoint(ts = "1999-06-01T00:00:00Z", fsmName = "charge"),
            )

        val result = FSMTimelineChartProjection.project(transitions, WINDOW_6H, NOW_MILLIS, UTC)

        assertFalse(result.isEmpty)
        assertEquals(listOf("charge", "vehicle"), result.fsmTypes)
        assertEquals(0.0, result.series.sumOf { it.values.sum() }, 0.0)
        assertEquals(BUCKETS_IN_6H_AT_10MIN, result.xLabels.size)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordFSMTimelineChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "FSMTimelineChart"), fields)
    }

    private fun seriesSum(
        result: FSMTimelineChartProjectionResult,
        name: String,
    ): Double {
        val match = result.series.first { it.name == name }
        return match.values.sum()
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
