package io.teslasync.android.featureviews.xraybucketchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the Ingest X-Ray bucket chart's pure logic — the native analogue of the web
 * component's derivations (web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx): the
 * buckets → (xLabels, values, accessible-table rows) projection with its empty guard and preserved order,
 * the locale-grouped count formatting (web `fmtInt`), the tolerant short-time formatting with its em-dash
 * guard (web `formatTime`), and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class XRayBucketChartProjectionTest {
    private val buckets =
        listOf(
            XRayBucketPoint(bucketStart = "2026-04-04T14:00:00Z", count = 1_204),
            XRayBucketPoint(bucketStart = "2026-04-04T15:00:00Z", count = 1_877),
            XRayBucketPoint(bucketStart = "2026-04-04T16:00:00Z", count = 0),
        )

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsBucketsPreservingOrderWithLabelsValuesAndTableRows() {
        val result =
            XRayBucketChartProjection.project(
                buckets = buckets,
                formatTime = { iso -> "T($iso)" },
                formatCount = { count -> "#$count" },
            )

        assertFalse(result.isEmpty)
        assertEquals(listOf("T(2026-04-04T14:00:00Z)", "T(2026-04-04T15:00:00Z)", "T(2026-04-04T16:00:00Z)"), result.xLabels)
        assertEquals(listOf(1_204.0, 1_877.0, 0.0), result.values)
        assertEquals(
            listOf(
                listOf("2026-04-04T14:00:00Z", "#1204"),
                listOf("2026-04-04T15:00:00Z", "#1877"),
                listOf("2026-04-04T16:00:00Z", "#0"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoBuckets() {
        val result =
            XRayBucketChartProjection.project(
                buckets = emptyList(),
                formatTime = { it },
                formatCount = { it.toString() },
            )

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.values.isEmpty())
        assertTrue(result.tableRows.isEmpty())
    }

    // ── Count formatting (web fmtInt parity) ──────────────────────────────────────

    @Test
    fun formatCountGroupsThousandsAndHandlesZero() {
        assertEquals("0", XRayBucketChartProjection.formatCount(0, Locale.US))
        assertEquals("1,204", XRayBucketChartProjection.formatCount(1_204, Locale.US))
        assertEquals("1,000,000", XRayBucketChartProjection.formatCount(1_000_000, Locale.US))
    }

    // ── Time formatting (web formatTime parity + invalid-date guard) ──────────────

    @Test
    fun formatRendersShortTimeInGivenZoneAndLocale() {
        val text = XRayBucketTimeFormatting.format("2026-04-04T14:30:00Z", ZoneOffset.UTC, Locale.US)
        assertTrue("expected short time, was: $text", text.contains("2:30"))
    }

    @Test
    fun formatAcceptsOffsetAndZonelessLocalDateTime() {
        assertTrue(XRayBucketTimeFormatting.format("2026-04-04T14:30:00+00:00", ZoneOffset.UTC, Locale.US).contains("2:30"))
        assertTrue(XRayBucketTimeFormatting.format("2026-04-04T14:30:00", ZoneOffset.UTC, Locale.US).contains("2:30"))
    }

    @Test
    fun formatReturnsEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, XRayBucketTimeFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, XRayBucketTimeFormatting.format("   ", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, XRayBucketTimeFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordXRayBucketChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "XRayBucketChart"), fields)
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
