package io.teslasync.android.featureviews.summarystatsrow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the SummaryStatsRow's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/admin/components/security-access/SummaryStatsRow.tsx and its
 * `timeSince` helper): the `timeSince(lastLockChange)` relative age, the `fmtInt(sentryUptime) + '%'`
 * uptime, the raw `totalEvents` rendering, and the secure/unsecure status flag. Because the surface is
 * purely presentational, each [SummaryStatsRowDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot"; the [formatLockChange] cases additionally verify the
 * accessible last-lock label is non-blank in every state.
 */
class SummaryStatsRowProjectionTest {
    private val labels =
        LockChangeLabels(
            dash = EM_DASH,
            justNow = "just now",
            minutesAgo = "%1\$sm ago",
            hoursAgo = "%1\$sh ago",
            daysAgo = "%1\$sd ago",
        )

    private val now = Instant.parse("2026-06-11T12:00:00Z").toEpochMilli()

    // ── project(): per-state ────────────────────────────────────────────────────

    @Test
    fun loadingProjectsTheLoadingFlagAndStillCarriesTheStatus() {
        val display =
            SummaryStatsRowProjection.project(
                summary =
                    SecuritySummary(
                        isSecure = true,
                        lastLockChange = "2026-06-11T11:55:00Z",
                        sentryUptime = 98.0,
                        totalEvents = 1234,
                    ),
                loading = true,
                nowMillis = now,
            )

        assertTrue(display.loading)
        assertTrue(display.isSecure)
    }

    @Test
    fun resolvedSecurePayloadProjectsEveryCardValue() {
        val display =
            SummaryStatsRowProjection.project(
                summary =
                    SecuritySummary(
                        isSecure = true,
                        lastLockChange = "2026-06-11T11:55:00Z",
                        sentryUptime = 98.0,
                        totalEvents = 1234,
                    ),
                loading = false,
                nowMillis = now,
            )

        assertFalse(display.loading)
        assertTrue(display.isSecure)
        // 5 minutes before `now`.
        assertEquals(LockChangeAge.Minutes(5), display.lastLock)
        assertEquals(98.0, display.sentryUptime, 0.0)
        assertEquals(1234, display.totalEvents)
    }

    @Test
    fun resolvedUnsecureAbsentLockChangeResolvesToZerosAndDash() {
        // Web: an absent `lastLockChange` makes `timeSince(undefined)` return '—', and the cards still render
        // (never a blank box) with the unsecure status and zeroed values.
        val display =
            SummaryStatsRowProjection.project(
                summary =
                    SecuritySummary(
                        isSecure = false,
                        lastLockChange = null,
                        sentryUptime = 0.0,
                        totalEvents = 0,
                    ),
                loading = false,
                nowMillis = now,
            )

        assertFalse(display.isSecure)
        assertEquals(LockChangeAge.Unknown, display.lastLock)
        assertEquals(0.0, display.sentryUptime, 0.0)
        assertEquals(0, display.totalEvents)
        assertEquals(EM_DASH, SummaryStatsRowProjection.formatLockChange(display.lastLock, labels))
    }

    @Test
    fun projectsStraightOffACachedIsoTimestampLikeTheOwningPageThreadsIt() {
        // The data-adapter path: the owning page caches the security-event history and threads the most
        // recent lock-change timestamp in. Decoding + projecting must yield the relative-age bucket.
        val twoHoursAgo = Instant.parse("2026-06-11T10:00:00Z").toString()

        val display =
            SummaryStatsRowProjection.project(
                summary =
                    SecuritySummary(
                        isSecure = true,
                        lastLockChange = twoHoursAgo,
                        sentryUptime = 75.0,
                        totalEvents = 42,
                    ),
                loading = false,
                nowMillis = now,
            )

        assertEquals(LockChangeAge.Hours(2), display.lastLock)
    }

    // ── lockChangeAge(): verbatim web `timeSince` cutoffs ─────────────────────────

    @Test
    fun lockChangeAgeReturnsUnknownForNullOrFutureTimestamps() {
        assertEquals(LockChangeAge.Unknown, SummaryStatsRowProjection.lockChangeAge(null, now))
        // Web `if (diff < 0) return '—'`: a future timestamp is "—", not "just now".
        assertEquals(LockChangeAge.Unknown, SummaryStatsRowProjection.lockChangeAge(now + 5_000L, now))
    }

    @Test
    fun lockChangeAgeBucketsSubMinuteAgesAsJustNow() {
        assertEquals(LockChangeAge.JustNow, SummaryStatsRowProjection.lockChangeAge(now, now))
        assertEquals(LockChangeAge.JustNow, SummaryStatsRowProjection.lockChangeAge(now - 30_000L, now))
        assertEquals(LockChangeAge.JustNow, SummaryStatsRowProjection.lockChangeAge(now - 59_000L, now))
    }

    @Test
    fun lockChangeAgeBucketsMinutesAndHours() {
        assertEquals(LockChangeAge.Minutes(1), SummaryStatsRowProjection.lockChangeAge(now - 60_000L, now))
        assertEquals(LockChangeAge.Minutes(59), SummaryStatsRowProjection.lockChangeAge(now - 59L * 60_000L, now))
        assertEquals(LockChangeAge.Hours(1), SummaryStatsRowProjection.lockChangeAge(now - 60L * 60_000L, now))
        assertEquals(LockChangeAge.Hours(23), SummaryStatsRowProjection.lockChangeAge(now - 23L * 3_600_000L, now))
    }

    @Test
    fun lockChangeAgeBucketsDaysWithoutWeekRollOver() {
        assertEquals(LockChangeAge.Days(1), SummaryStatsRowProjection.lockChangeAge(now - 24L * 3_600_000L, now))
        // Distinct from the shared `relativeAge`, which would roll 10 days into "1w ago"; web `timeSince`
        // stays in days, so 10 days is "10d ago".
        assertEquals(LockChangeAge.Days(10), SummaryStatsRowProjection.lockChangeAge(now - 10L * 86_400_000L, now))
    }

    // ── parseIsoMillis(): tolerant RFC-3339 parsing ──────────────────────────────

    @Test
    fun parseIsoMillisHandlesZuluOffsetAndZonedShapes() {
        val expected = Instant.parse("2026-06-11T10:00:00Z").toEpochMilli()
        assertEquals(expected, SummaryStatsRowProjection.parseIsoMillis("2026-06-11T10:00:00Z"))
        // Same instant expressed with a +02:00 offset.
        assertEquals(expected, SummaryStatsRowProjection.parseIsoMillis("2026-06-11T12:00:00+02:00"))
    }

    @Test
    fun parseIsoMillisReturnsNullForBlankOrUnparseableInput() {
        assertNull(SummaryStatsRowProjection.parseIsoMillis(null))
        assertNull(SummaryStatsRowProjection.parseIsoMillis(""))
        assertNull(SummaryStatsRowProjection.parseIsoMillis("   "))
        assertNull(SummaryStatsRowProjection.parseIsoMillis("not-a-timestamp"))
    }

    // ── formatUptimePercent(): web `fmtInt(...) + '%'` ───────────────────────────

    @Test
    fun formatUptimePercentRoundsHalfUpToMatchIntlNumberFormat() {
        // Intl.NumberFormat's default "halfExpand" rounding: 62.5 → "63", not banker's "62".
        assertEquals("63%", SummaryStatsRowProjection.formatUptimePercent(62.5, Locale.US))
        assertEquals("98%", SummaryStatsRowProjection.formatUptimePercent(98.4, Locale.US))
        assertEquals("43%", SummaryStatsRowProjection.formatUptimePercent(42.6, Locale.US))
        assertEquals("0%", SummaryStatsRowProjection.formatUptimePercent(0.0, Locale.US))
        assertEquals("100%", SummaryStatsRowProjection.formatUptimePercent(100.0, Locale.US))
    }

    @Test
    fun formatUptimePercentCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0%", SummaryStatsRowProjection.formatUptimePercent(Double.NaN, Locale.US))
        assertEquals("0%", SummaryStatsRowProjection.formatUptimePercent(Double.POSITIVE_INFINITY, Locale.US))
    }

    @Test
    fun formatUptimePercentAppliesLocaleGroupingLikeFmtInt() {
        assertEquals("1,234%", SummaryStatsRowProjection.formatUptimePercent(1234.0, Locale.US))
        val german = SummaryStatsRowProjection.formatUptimePercent(1234.0, Locale.GERMANY)
        assertFalse(german.contains(","))
    }

    // ── formatEventCount(): web renders the raw numeric child ────────────────────

    @Test
    fun formatEventCountRendersTheRawNumberWithoutGrouping() {
        // Web `value={totalEvents}` renders React's bare numeric child — no locale grouping, unlike uptime.
        assertEquals("0", SummaryStatsRowProjection.formatEventCount(0))
        assertEquals("87", SummaryStatsRowProjection.formatEventCount(87))
        assertEquals("1234", SummaryStatsRowProjection.formatEventCount(1234))
    }

    // ── formatLockChange(): accessible-label mapping (every branch non-blank) ─────

    @Test
    fun formatLockChangeMapsEveryBucketToANonBlankAccessibleLabel() {
        val cases =
            mapOf(
                LockChangeAge.Unknown to EM_DASH,
                LockChangeAge.JustNow to "just now",
                LockChangeAge.Minutes(5) to "5m ago",
                LockChangeAge.Hours(3) to "3h ago",
                LockChangeAge.Days(10) to "10d ago",
            )
        cases.forEach { (age, expected) ->
            val rendered = SummaryStatsRowProjection.formatLockChange(age, labels)
            assertEquals(expected, rendered)
            assertTrue("label for $age must not be blank", rendered.isNotBlank())
        }
    }
}
