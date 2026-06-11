package io.teslasync.android.featureviews.sentrymodechart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the Sentry Mode Activity chart's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/admin/components/security-access/SentryModeChart.tsx): the
 * buckets → (xLabels, sentryOn values, sentryOff values) projection with its empty guard and preserved
 * order, the locale-grouped count formatting (web `<YAxis allowDecimals={false} />`), the tolerant short-date
 * formatting with its em-dash guard (web `formatDateShort`), and the PII-safe `view.opened` diagnostic.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class SentryModeChartProjectionTest {
    private val buckets =
        listOf(
            SentryDayBucket(date = "2026-04-02", sentryOn = 12, sentryOff = 4),
            SentryDayBucket(date = "2026-04-03", sentryOn = 9, sentryOff = 7),
            SentryDayBucket(date = "2026-04-04", sentryOn = 0, sentryOff = 0),
        )

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsBucketsPreservingOrderWithLabelsAndBothSeries() {
        val result =
            SentryModeChartProjection.project(
                buckets = buckets,
                formatDate = { date -> "D($date)" },
            )

        assertFalse(result.isEmpty)
        assertEquals(listOf("D(2026-04-02)", "D(2026-04-03)", "D(2026-04-04)"), result.xLabels)
        assertEquals(listOf(12.0, 9.0, 0.0), result.sentryOnValues)
        assertEquals(listOf(4.0, 7.0, 0.0), result.sentryOffValues)
    }

    @Test
    fun projectReturnsEmptyResultForNoBuckets() {
        val result =
            SentryModeChartProjection.project(
                buckets = emptyList(),
                formatDate = { it },
            )

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.sentryOnValues.isEmpty())
        assertTrue(result.sentryOffValues.isEmpty())
    }

    // ── Count formatting (web YAxis integer parity) ───────────────────────────────

    @Test
    fun formatCountGroupsThousandsAndHandlesZero() {
        assertEquals("0", SentryModeChartProjection.formatCount(0, Locale.US))
        assertEquals("1,204", SentryModeChartProjection.formatCount(1_204, Locale.US))
        assertEquals("1,000,000", SentryModeChartProjection.formatCount(1_000_000, Locale.US))
    }

    // ── Date formatting (web formatDateShort parity + invalid-date guard) ──────────

    @Test
    fun formatRendersShortMonthAndDayInGivenLocale() {
        assertEquals("Apr 4", SentryDateFormatting.format("2026-04-04", ZoneOffset.UTC, Locale.US))
        assertEquals("Dec 25", SentryDateFormatting.format("2026-12-25", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun formatAcceptsOffsetZonelessAndInstantDateTimes() {
        assertEquals("Apr 4", SentryDateFormatting.format("2026-04-04T14:30:00+00:00", ZoneOffset.UTC, Locale.US))
        assertEquals("Apr 4", SentryDateFormatting.format("2026-04-04T14:30:00", ZoneOffset.UTC, Locale.US))
        assertEquals("Apr 4", SentryDateFormatting.format("2026-04-04T14:30:00Z", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun formatReturnsEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, SentryDateFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, SentryDateFormatting.format("   ", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, SentryDateFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSentryModeChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SentryModeChart"), fields)
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
