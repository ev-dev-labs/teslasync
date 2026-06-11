package io.teslasync.android.featureviews.auditpanel

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the AuditPanel's pure projection — the native port of the web component's
 * `(rows, loading, scopedDlqId)` render contract (web/src/features/admin/components/dlq-inspector/
 * AuditPanel.tsx): the `(rows, loading)` → lifecycle [UiPhase] adapter, the `RESULT_VARIANT` → Badge map
 * (incl. the `?? 'neutral'` fallback), the `value || '—'` cell fallback, the `scopedDlqId` truthiness, the
 * absolute `replayed_at` formatting, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate; no Compose, no device.
 */
class AuditPanelProjectionTest {
    private fun record(id: Long): DLQReplayAuditRecord =
        DLQReplayAuditRecord(
            id = id,
            replayedAt = "2026-06-11T12:00:00Z",
            actor = "ops@teslasync.io",
            dlqId = 4821,
            result = "ok",
            dstTopic = "telemetry/ingest",
            error = "",
            traceId = "trace-1",
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

    // ── (rows, loading) → lifecycle UiState adapter (web's empty-vs-table branch) ─────────────────────

    @Test
    fun contentWhenRowsPresent() {
        val rows = listOf(record(id = 1), record(id = 2))
        val state = AuditPanelProjection.projectUiState(rows, loading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(rows, state.data)
        assertFalse(state.refreshing)
    }

    @Test
    fun contentWhenRowsPresentIgnoresLoading() {
        // Web parity: once rows exist the table is shown; `loading` has no visible effect on the panel.
        val rows = listOf(record(id = 1))
        val state = AuditPanelProjection.projectUiState(rows, loading = true)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(rows, state.data)
    }

    @Test
    fun loadingWhenEmptyAndLoading() {
        val state = AuditPanelProjection.projectUiState(emptyList(), loading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun emptyWhenEmptyAndNotLoading() {
        val state = AuditPanelProjection.projectUiState(emptyList(), loading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    // ── RESULT_VARIANT map + `?? 'neutral'` fallback ──────────────────────────────────────────────────

    @Test
    fun resultVariantMapsEveryKnownResult() {
        assertEquals(BadgeVariant.Success, AuditPanelProjection.resultVariant("ok"))
        assertEquals(BadgeVariant.Danger, AuditPanelProjection.resultVariant("publish_failed"))
        assertEquals(BadgeVariant.Warning, AuditPanelProjection.resultVariant("rate_limited"))
        assertEquals(BadgeVariant.Warning, AuditPanelProjection.resultVariant("disabled"))
        assertEquals(BadgeVariant.Neutral, AuditPanelProjection.resultVariant("not_found"))
        assertEquals(BadgeVariant.Danger, AuditPanelProjection.resultVariant("unparseable"))
    }

    @Test
    fun resultVariantUnknownFallsBackToNeutral() {
        assertEquals(BadgeVariant.Neutral, AuditPanelProjection.resultVariant("some_future_result"))
        assertEquals(BadgeVariant.Neutral, AuditPanelProjection.resultVariant(""))
    }

    // ── `value || '—'` cell fallback ──────────────────────────────────────────────────────────────────

    @Test
    fun valueOrDashReplacesEmpty() {
        assertEquals(EM_DASH, AuditPanelProjection.valueOrDash(""))
    }

    @Test
    fun valueOrDashKeepsNonEmpty() {
        assertEquals("telemetry/ingest", AuditPanelProjection.valueOrDash("telemetry/ingest"))
    }

    // ── scopedDlqId truthiness (web `scopedDlqId ? scoped : global`) ─────────────────────────────────

    @Test
    fun scopedWhenPositiveId() {
        assertTrue(AuditPanelProjection.isScoped(4821))
    }

    @Test
    fun globalWhenNullOrZeroId() {
        assertFalse(AuditPanelProjection.isScoped(null))
        assertFalse(AuditPanelProjection.isScoped(0))
    }

    // ── Absolute timestamp formatting (web `<TimeStamp format="absolute" />`) ─────────────────────────

    @Test
    fun formatsIsoTimestampInZone() {
        val formatted = AuditPanelTimeFormatting.format("2026-06-11T12:00:00Z", ZoneId.of("UTC"), Locale.US)
        assertTrue("expected a year in '$formatted'", formatted.contains("2026"))
        assertFalse("a valid timestamp must not fall back to the em dash", formatted == EM_DASH)
    }

    @Test
    fun parsesOffsetDateTime() {
        val formatted = AuditPanelTimeFormatting.format("2026-06-11T12:00:00+02:00", ZoneId.of("UTC"), Locale.US)
        assertTrue(formatted.contains("2026"))
    }

    @Test
    fun blankTimestampYieldsEmDash() {
        assertEquals(EM_DASH, AuditPanelTimeFormatting.format("", ZoneId.of("UTC"), Locale.US))
        assertEquals(EM_DASH, AuditPanelTimeFormatting.format("   ", ZoneId.of("UTC"), Locale.US))
    }

    @Test
    fun unparseableTimestampYieldsEmDash() {
        assertEquals(EM_DASH, AuditPanelTimeFormatting.format("not-a-timestamp", ZoneId.of("UTC"), Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordAuditPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "AuditPanel"), opened.single().second)
        assertEquals("AuditPanel", AUDIT_PANEL_SLUG)
    }
}
