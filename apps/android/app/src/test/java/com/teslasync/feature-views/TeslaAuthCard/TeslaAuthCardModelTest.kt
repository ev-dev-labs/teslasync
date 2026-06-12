// Off-device unit coverage for the TeslaAuthCard feature view's pure model (P3 acceptance: adapter test). Exercises
// the severity classifier (web `severityFor` — disconnected / unknown / expired / warn / ok and their boundaries),
// the floor-divided day countdown (web `Math.floor((exp - now) / DAY)`, tolerant of Z / offset / zoneless
// timestamps), the full projection (severity -> detail kind + reauthenticate CTA flag, branch-for-branch with the
// web `detail` memo + the `expired || disconnected` ternary), the registry identifiers, and the PII-safe
// `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaauthcard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class TeslaAuthCardModelTest {
    private val now: Instant = Instant.parse("2026-01-01T00:00:00Z")

    // ── Severity classifier (web severityFor) ─────────────────────────────────

    @Test
    fun severityIsDisconnectedWhenAuthenticatedIsExactlyFalse() {
        assertEquals(AuthSeverity.Disconnected, TeslaAuthCardProjection.severityFor(false, null, now))
        // A literal false short-circuits even when a (valid) expiry is present — web `authenticated === false` first.
        assertEquals(
            AuthSeverity.Disconnected,
            TeslaAuthCardProjection.severityFor(false, "2999-01-01T00:00:00Z", now),
        )
    }

    @Test
    fun severityIsUnknownWhenExpiryMissingOrUnparseable() {
        assertEquals(AuthSeverity.Unknown, TeslaAuthCardProjection.severityFor(true, null, now))
        assertEquals(AuthSeverity.Unknown, TeslaAuthCardProjection.severityFor(null, null, now))
        assertEquals(AuthSeverity.Unknown, TeslaAuthCardProjection.severityFor(true, "", now))
        assertEquals(AuthSeverity.Unknown, TeslaAuthCardProjection.severityFor(true, "not-a-date", now))
    }

    @Test
    fun severityIsExpiredForAnyPastInstant() {
        assertEquals(AuthSeverity.Expired, TeslaAuthCardProjection.severityFor(true, "2025-12-31T00:00:00Z", now))
        // One second in the past floor-divides to -1 day — still expired.
        assertEquals(AuthSeverity.Expired, TeslaAuthCardProjection.severityFor(true, "2025-12-31T23:59:59Z", now))
    }

    @Test
    fun severityIsWarnFromTodayThroughTheSeventhDayInclusive() {
        assertEquals(AuthSeverity.Warn, TeslaAuthCardProjection.severityFor(true, "2026-01-01T00:00:00Z", now))
        assertEquals(AuthSeverity.Warn, TeslaAuthCardProjection.severityFor(true, "2026-01-01T12:00:00Z", now))
        assertEquals(AuthSeverity.Warn, TeslaAuthCardProjection.severityFor(true, "2026-01-08T00:00:00Z", now))
        assertEquals(AuthSeverity.Warn, TeslaAuthCardProjection.severityFor(true, "2026-01-08T23:59:59Z", now))
    }

    @Test
    fun severityIsOkFromTheEighthDayOnward() {
        assertEquals(AuthSeverity.Ok, TeslaAuthCardProjection.severityFor(true, "2026-01-09T00:00:00Z", now))
        assertEquals(AuthSeverity.Ok, TeslaAuthCardProjection.severityFor(true, "2026-02-01T00:00:00Z", now))
    }

    @Test
    fun severityIgnoresNullAuthenticatedAndClassifiesByExpiry() {
        // web: only `=== false` is disconnected; undefined/null falls through to the expiry buckets.
        assertEquals(AuthSeverity.Ok, TeslaAuthCardProjection.severityFor(null, "2026-02-01T00:00:00Z", now))
        assertEquals(AuthSeverity.Warn, TeslaAuthCardProjection.severityFor(null, "2026-01-05T00:00:00Z", now))
    }

    // ── Day countdown (web Math.floor + Date.parse tolerance) ─────────────────

    @Test
    fun daysUntilFloorsTowardNegativeInfinity() {
        assertEquals(7L, TeslaAuthCardProjection.daysUntil("2026-01-08T00:00:00Z", now))
        assertEquals(7L, TeslaAuthCardProjection.daysUntil("2026-01-08T12:00:00Z", now))
        assertEquals(0L, TeslaAuthCardProjection.daysUntil("2026-01-01T12:00:00Z", now))
        assertEquals(-1L, TeslaAuthCardProjection.daysUntil("2025-12-31T00:00:00Z", now))
        assertEquals(-1L, TeslaAuthCardProjection.daysUntil("2025-12-31T23:59:59Z", now))
    }

    @Test
    fun daysUntilReturnsNullForBlankOrUnparseableTimestamps() {
        assertNull(TeslaAuthCardProjection.daysUntil(null, now))
        assertNull(TeslaAuthCardProjection.daysUntil("", now))
        assertNull(TeslaAuthCardProjection.daysUntil("   ", now))
        assertNull(TeslaAuthCardProjection.daysUntil("nonsense", now))
    }

    @Test
    fun daysUntilAcceptsOffsetAndZonelessTimestamps() {
        assertEquals(7L, TeslaAuthCardProjection.daysUntil("2026-01-08T00:00:00+00:00", now))
        assertEquals(7L, TeslaAuthCardProjection.daysUntil("2026-01-08T00:00:00", now))
    }

    // ── Full projection (web detail memo + CTA ternary) ───────────────────────

    @Test
    fun projectDisconnectedShowsNotConnectedDetailAndReauthCta() {
        val row = TeslaAuthCardProjection.project(TeslaAuthStatus(authenticated = false, expiresAt = null), now)
        assertEquals(AuthSeverity.Disconnected, row.severity)
        assertEquals(AuthDetail.NotConnected, row.detail)
        assertTrue(row.reauthenticate)
    }

    @Test
    fun projectExpiredShowsReconnectDetailAndReauthCta() {
        val row =
            TeslaAuthCardProjection.project(TeslaAuthStatus(authenticated = true, expiresAt = "2025-12-01T00:00:00Z"), now)
        assertEquals(AuthSeverity.Expired, row.severity)
        assertEquals(AuthDetail.Reconnect, row.detail)
        assertTrue(row.reauthenticate)
    }

    @Test
    fun projectUnknownShowsReconnectDetailButManageCta() {
        val row = TeslaAuthCardProjection.project(TeslaAuthStatus(authenticated = true, expiresAt = null), now)
        assertEquals(AuthSeverity.Unknown, row.severity)
        assertEquals(AuthDetail.Reconnect, row.detail)
        assertFalse(row.reauthenticate)
    }

    @Test
    fun projectWarnShowsExpiresInDaysCountdownAndManageCta() {
        val row =
            TeslaAuthCardProjection.project(TeslaAuthStatus(authenticated = true, expiresAt = "2026-01-04T00:00:00Z"), now)
        assertEquals(AuthSeverity.Warn, row.severity)
        assertEquals(AuthDetail.ExpiresInDays(3L), row.detail)
        assertFalse(row.reauthenticate)
    }

    @Test
    fun projectOkShowsExpiresInDaysCountdownAndManageCta() {
        val row =
            TeslaAuthCardProjection.project(TeslaAuthStatus(authenticated = true, expiresAt = "2026-01-31T00:00:00Z"), now)
        assertEquals(AuthSeverity.Ok, row.severity)
        assertEquals(AuthDetail.ExpiresInDays(30L), row.detail)
        assertFalse(row.reauthenticate)
    }

    @Test
    fun projectClampsTheCountdownToZeroOnTheExpiryDay() {
        val row =
            TeslaAuthCardProjection.project(TeslaAuthStatus(authenticated = true, expiresAt = "2026-01-01T06:00:00Z"), now)
        assertEquals(AuthSeverity.Warn, row.severity)
        assertEquals(AuthDetail.ExpiresInDays(0L), row.detail)
    }

    // ── Registry + diagnostics (P1/S11 view.opened) ───────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("tesla-auth-card", TeslaAuthCardRegistration.ID)
        assertEquals("TeslaAuthCard", TeslaAuthCardRegistration.SLUG)
    }

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordTeslaAuthCardOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "TeslaAuthCard"), record.fields)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }
}
