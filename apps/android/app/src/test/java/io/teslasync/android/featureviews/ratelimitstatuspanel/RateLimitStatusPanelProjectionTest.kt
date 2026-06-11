package io.teslasync.android.featureviews.ratelimitstatuspanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.system.RateLimitStatusResponse
import io.teslasync.shared.core.presentation.system.ScopeBudget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the RateLimitStatusPanel's pure projection — the native port of the web
 * component's per-scope derivations (severity band, bar maximum `limit > 0 ? limit : 1`, instant-vs-window
 * label, the `reset_at` countdown gate, the `formatDurationMsLong` long duration, the `fmtNumber` budget
 * formatter, the `generated_at` "updated" parse) and the PII-safe `view.opened` diagnostic. Mirrors the
 * web spec (web/src/features/admin/components/RateLimitStatusPanel.tsx).
 */
class RateLimitStatusPanelProjectionTest {
    @Suppress("LongParameterList")
    private fun scope(
        id: String = "tesla_fleet",
        name: String = "Tesla Fleet API",
        current: Double = 820.0,
        limit: Double = 1000.0,
        windowSeconds: Int = 3600,
        resetAt: String? = null,
        severity: String = "warn",
        detail: String = "",
    ): ScopeBudget = ScopeBudget(id, name, current, limit, windowSeconds, resetAt, severity, detail)

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

    // ── Severity band (web RateLimitSeverity) ────────────────────────────────────────────────────────

    @Test
    fun severityFromWireMapsKnownBands() {
        assertEquals(RateLimitSeverity.Ok, RateLimitSeverity.fromWire("ok"))
        assertEquals(RateLimitSeverity.Warn, RateLimitSeverity.fromWire("warn"))
        assertEquals(RateLimitSeverity.Critical, RateLimitSeverity.fromWire("critical"))
    }

    @Test
    fun severityFromWireIsCaseInsensitive() {
        assertEquals(RateLimitSeverity.Critical, RateLimitSeverity.fromWire("  CRITICAL "))
    }

    @Test
    fun severityFromWireUnknownFallsBack() {
        assertEquals(RateLimitSeverity.Unknown, RateLimitSeverity.fromWire("degraded"))
        assertEquals(RateLimitSeverity.Unknown, RateLimitSeverity.fromWire(""))
    }

    // ── Row projection (bar maximum + severity wire passthrough) ─────────────────────────────────────

    @Test
    fun rowKeepsBackendFieldsAndBand() {
        val view = RateLimitStatusPanelProjection.row(scope(severity = "warn", detail = "shared"))
        assertEquals("tesla_fleet", view.id)
        assertEquals("Tesla Fleet API", view.name)
        assertEquals(RateLimitSeverity.Warn, view.severity)
        assertEquals("warn", view.severityWire)
        assertEquals(820.0, view.current, 0.0)
        assertEquals(1000.0, view.limit, 0.0)
        assertEquals(3600, view.windowSeconds)
        assertEquals("shared", view.detail)
    }

    @Test
    fun rowBarMaxClampsNonPositiveLimitToOne() {
        // web `max={scope.limit > 0 ? scope.limit : 1}` — a zero/negative limit never divides by zero.
        assertEquals(1000.0, RateLimitStatusPanelProjection.row(scope(limit = 1000.0)).barMax, 0.0)
        assertEquals(1.0, RateLimitStatusPanelProjection.row(scope(limit = 0.0)).barMax, 0.0)
        assertEquals(1.0, RateLimitStatusPanelProjection.row(scope(limit = -5.0)).barMax, 0.0)
    }

    @Test
    fun rowUnknownSeverityKeepsWireValue() {
        val view = RateLimitStatusPanelProjection.row(scope(severity = "degraded"))
        assertEquals(RateLimitSeverity.Unknown, view.severity)
        assertEquals("degraded", view.severityWire)
    }

    @Test
    fun rowsMapsEveryScopeInOrderAndNullToEmpty() {
        val response =
            RateLimitStatusResponse(
                generatedAt = "2026-06-11T12:00:00Z",
                scopes = listOf(scope(id = "a"), scope(id = "b"), scope(id = "c")),
            )
        assertEquals(listOf("a", "b", "c"), RateLimitStatusPanelProjection.rows(response).map { it.id })
        assertTrue(RateLimitStatusPanelProjection.rows(null).isEmpty())
    }

    // ── Empty + window-label decisions ───────────────────────────────────────────────────────────────

    @Test
    fun isEmptyWhenNoScopes() {
        assertTrue(RateLimitStatusPanelProjection.isEmpty(RateLimitStatusResponse(scopes = emptyList())))
        assertFalse(RateLimitStatusPanelProjection.isEmpty(RateLimitStatusResponse(scopes = listOf(scope()))))
    }

    @Test
    fun instantWindowWhenSecondsNonPositive() {
        // web `!scope.window_seconds || scope.window_seconds <= 0` → "Live snapshot".
        assertTrue(RateLimitStatusPanelProjection.isInstantWindow(0))
        assertTrue(RateLimitStatusPanelProjection.isInstantWindow(-1))
        assertFalse(RateLimitStatusPanelProjection.isInstantWindow(60))
    }

    // ── Reset countdown gate (web reset_at → ms-until-refill) ─────────────────────────────────────────

    @Test
    fun resetCountdownNullWhenAbsentOrUnparseable() {
        assertNull(RateLimitStatusPanelProjection.resetCountdownMs(null, 0L))
        assertNull(RateLimitStatusPanelProjection.resetCountdownMs("", 0L))
        assertNull(RateLimitStatusPanelProjection.resetCountdownMs("not-a-timestamp", 0L))
    }

    @Test
    fun resetCountdownPositiveOnlyForFuture() {
        val resetAt = "2026-06-11T12:05:00Z"
        val resetMs = Instant.parse(resetAt).toEpochMilli()
        assertEquals(5_000L, RateLimitStatusPanelProjection.resetCountdownMs(resetAt, resetMs - 5_000L))
        // web `if (ms <= 0) return null` — an already-refilled or exactly-now bucket shows no countdown.
        assertNull(RateLimitStatusPanelProjection.resetCountdownMs(resetAt, resetMs))
        assertNull(RateLimitStatusPanelProjection.resetCountdownMs(resetAt, resetMs + 5_000L))
    }

    @Test
    fun resetCountdownAcceptsOffsetAndZonelessTimestamps() {
        val offsetMs = Instant.parse("2026-06-11T10:00:00Z").toEpochMilli()
        assertEquals(1_000L, RateLimitStatusPanelProjection.resetCountdownMs("2026-06-11T12:00:00+02:00", offsetMs - 1_000L))
        val zonelessMs = Instant.parse("2026-06-11T12:00:00Z").toEpochMilli()
        assertEquals(1_000L, RateLimitStatusPanelProjection.resetCountdownMs("2026-06-11T12:00:00", zonelessMs - 1_000L))
    }

    // ── Long duration (web formatDurationMsLong) ─────────────────────────────────────────────────────

    @Test
    fun formatResetDurationSubSecond() {
        assertEquals("500ms", RateLimitStatusPanelProjection.formatResetDuration(500L))
        assertEquals("999ms", RateLimitStatusPanelProjection.formatResetDuration(999L))
    }

    @Test
    fun formatResetDurationSubMinuteHasOneDecimal() {
        assertEquals("1.0s", RateLimitStatusPanelProjection.formatResetDuration(1_000L))
        assertEquals("1.5s", RateLimitStatusPanelProjection.formatResetDuration(1_500L))
        assertEquals("59.9s", RateLimitStatusPanelProjection.formatResetDuration(59_900L))
    }

    @Test
    fun formatResetDurationMinutesAndRoundedSeconds() {
        assertEquals("1m 0s", RateLimitStatusPanelProjection.formatResetDuration(60_000L))
        assertEquals("1m 30s", RateLimitStatusPanelProjection.formatResetDuration(90_000L))
        // 125.4s → 2m + round(5.4) = 5s.
        assertEquals("2m 5s", RateLimitStatusPanelProjection.formatResetDuration(125_400L))
    }

    // ── Budget number (web fmtNumber) ────────────────────────────────────────────────────────────────

    @Test
    fun formatBudgetGroupsWithTwoFractionDigits() {
        assertEquals("42.00", RateLimitStatusPanelProjection.formatBudget(42.0, Locale.US))
        assertEquals("1,234.50", RateLimitStatusPanelProjection.formatBudget(1234.5, Locale.US))
        assertEquals("50,000.00", RateLimitStatusPanelProjection.formatBudget(50_000.0, Locale.US))
    }

    @Test
    fun formatBudgetGuardsNonFiniteAndClampsPrecision() {
        assertEquals("0.00", RateLimitStatusPanelProjection.formatBudget(Double.NaN, Locale.US))
        assertEquals("0.00", RateLimitStatusPanelProjection.formatBudget(Double.POSITIVE_INFINITY, Locale.US))
        assertEquals("42", RateLimitStatusPanelProjection.formatBudget(42.0, Locale.US, precision = 0))
    }

    // ── Updated-at parse (web generated_at → formatRelative input) ───────────────────────────────────

    @Test
    fun updatedAtMillisParsesOrNull() {
        assertNull(RateLimitStatusPanelProjection.updatedAtMillis(""))
        assertNull(RateLimitStatusPanelProjection.updatedAtMillis("   "))
        assertNull(RateLimitStatusPanelProjection.updatedAtMillis("nonsense"))
        assertEquals(
            Instant.parse("2026-06-11T12:00:00Z").toEpochMilli(),
            RateLimitStatusPanelProjection.updatedAtMillis("2026-06-11T12:00:00Z"),
        )
    }

    // ── Diagnostics (P1/S11 view.opened) ─────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordRateLimitStatusPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "RateLimitStatusPanel"), opened.single().second)
    }
}
