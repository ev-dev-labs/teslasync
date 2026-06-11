package io.teslasync.android.featureviews.statusheader

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the StatusHeader's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/admin/components/dlq-inspector/StatusHeader.tsx): the
 * `data?.count ?? 0` total, the `entries.filter(e => e.replayable).length` replayable count, the
 * `data?.replay_enabled ?? false` flag, the `!loading && !enabled` warning gate, and the `fmtInt`
 * locale-aware integer formatting. Because the surface is purely presentational each [StatusHeaderDisplay]
 * is exactly what the thin composable renders, so these assertions double as the per-state "snapshot".
 */
class StatusHeaderProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private fun data(
        count: Int,
        replayEnabled: Boolean,
        replayableFlags: List<Boolean>,
    ) = DlqListResponse(
        count = count,
        replayEnabled = replayEnabled,
        entries = replayableFlags.map { DlqEntrySummary(replayable = it) },
    )

    @Test
    fun loadingRendersSkeletonChromeAndWithholdsTheWarning() {
        val display = StatusHeaderProjection.project(data = null, loading = true)

        assertTrue(display.loading)
        assertEquals(0, display.totalEntries)
        assertEquals(0, display.replayableEntries)
        assertFalse(display.replayEnabled)
        // Web `!loading && !enabled`: the warning is withheld while loading even though replay is disabled.
        assertFalse(display.showDisabledBanner)
    }

    @Test
    fun absentPayloadResolvesToZerosAndShowsTheDisabledWarning() {
        // Web nullish coalescing: a missing payload yields zeros + enabled=false, so the three cards still
        // render (never a blank box) and the "replay disabled" warning is shown.
        val display = StatusHeaderProjection.project(data = null, loading = false)

        assertFalse(display.loading)
        assertEquals(0, display.totalEntries)
        assertEquals(0, display.replayableEntries)
        assertFalse(display.replayEnabled)
        assertTrue(display.showDisabledBanner)
    }

    @Test
    fun populatedDisabledPayloadProjectsCountsAndShowsWarning() {
        val display =
            StatusHeaderProjection.project(
                data = data(count = 1234, replayEnabled = false, replayableFlags = listOf(true, true, false)),
                loading = false,
            )

        assertEquals(1234, display.totalEntries)
        assertEquals(2, display.replayableEntries)
        assertFalse(display.replayEnabled)
        assertTrue(display.showDisabledBanner)
    }

    @Test
    fun enabledPayloadHidesTheWarning() {
        val display =
            StatusHeaderProjection.project(
                data = data(count = 5, replayEnabled = true, replayableFlags = listOf(true)),
                loading = false,
            )

        assertTrue(display.replayEnabled)
        // Web `!loading && !enabled` is false when replay is enabled.
        assertFalse(display.showDisabledBanner)
    }

    @Test
    fun replayableCountsOnlyReplayableEntries() {
        val display =
            StatusHeaderProjection.project(
                data = data(count = 4, replayEnabled = false, replayableFlags = listOf(true, false, true, false)),
                loading = false,
            )

        assertEquals(2, display.replayableEntries)
    }

    @Test
    fun totalReadsTheCountFieldNotTheReturnedEntriesSize() {
        // Web `data?.count ?? 0`: the list endpoint may page the entries, so the total is the `count`
        // field, independent of how many rows are returned.
        val display =
            StatusHeaderProjection.project(
                data = data(count = 900, replayEnabled = false, replayableFlags = listOf(true, true)),
                loading = false,
            )

        assertEquals(900, display.totalEntries)
        assertEquals(2, display.replayableEntries)
    }

    @Test
    fun projectsStraightOffTheCachedApiJsonIgnoringUnknownEntryColumns() {
        // The data adapter path: the owning page caches the raw API response, whose entry rows carry many
        // more columns than this surface reads. Decoding + projecting must yield the same view.
        val json =
            """
            {
              "count": 1234,
              "replay_enabled": false,
              "entries": [
                { "id": 1, "replayable": true, "dlq_topic": "telemetry/x", "parse_error": null },
                { "id": 2, "replayable": true, "raw_payload_size": 42 },
                { "id": 3, "replayable": false }
              ]
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString<DlqListResponse>(json)

        val display = StatusHeaderProjection.project(decoded, loading = false)

        assertEquals(1234, display.totalEntries)
        assertEquals(2, display.replayableEntries)
        assertFalse(display.replayEnabled)
        assertTrue(display.showDisabledBanner)
    }

    @Test
    fun formatCountAddsLocaleAwareGroupingSeparators() {
        // Web `fmtInt` → Intl.NumberFormat with zero fraction digits and locale grouping.
        assertEquals("0", StatusHeaderProjection.formatCount(0, Locale.US))
        assertEquals("42", StatusHeaderProjection.formatCount(42, Locale.US))
        assertEquals("1,234", StatusHeaderProjection.formatCount(1234, Locale.US))
        assertEquals("1,000,000", StatusHeaderProjection.formatCount(1_000_000, Locale.US))
    }

    @Test
    fun formatCountHonoursTheRequestedLocale() {
        val us = StatusHeaderProjection.formatCount(1234, Locale.US)
        val de = StatusHeaderProjection.formatCount(1234, Locale.GERMANY)

        // German grouping is not a comma, proving the formatter is locale-aware rather than hard-coded.
        assertFalse(de.contains(","))
        assertTrue(us != de)
    }
}
