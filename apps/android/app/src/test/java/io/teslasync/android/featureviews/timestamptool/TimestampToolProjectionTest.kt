package io.teslasync.android.featureviews.timestamptool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the TimestampTool's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/admin/components/devtools/tools/TimestampTool.tsx): the live clock, the
 * `fromUnix` / `fromIso` parse memos (`parseInt` + the `> 10` seconds/millis split + JS `Date` validity), the
 * `toISOString` rendering, and the `getRelativeTime` / `formatDateTime` helpers. Because the surface is purely
 * presentational, each projected value is exactly what the thin composable renders, so this is also the
 * per-state "snapshot". Runs in the :android:testReleaseUnitTest gate; the on-device render + accessibility are
 * covered by TimestampToolUiTest.
 */
class TimestampToolProjectionTest {
    private val utc: ZoneId = ZoneOffset.UTC
    private val us: Locale = Locale.US

    // 1_700_000_000 s = 2023-11-14T22:13:20Z — a fixed reference instant used across the parse/format tests.
    private val reference: Instant = Instant.ofEpochSecond(1_700_000_000L)

    // ── live clock + "Now" values (web floor(now/1000) + now.toISOString()) ──────────

    @Test
    fun unixSecondsFloorsTowardNegativeInfinityLikeMathFloor() {
        assertEquals(1_700_000_000L, TimestampToolProjection.unixSeconds(reference))
        // Math.floor(-0.5) === -1: a sub-second negative instant floors down, not toward zero.
        assertEquals(-1L, TimestampToolProjection.unixSeconds(Instant.ofEpochMilli(-500L)))
    }

    @Test
    fun toIsoMatchesJsToISOStringWithThreeMillisDigitsAndZ() {
        assertEquals("2023-11-14T22:13:20.000Z", TimestampToolProjection.toIso(reference))
        assertEquals("2024-01-01T00:00:00.000Z", TimestampToolProjection.toIso(Instant.parse("2024-01-01T00:00:00Z")))
    }

    @Test
    fun liveClockAndNowFieldValuesExposeTheSecondsAndIso() {
        val clock = TimestampToolProjection.liveClock(reference)
        assertEquals("1700000000", clock.unixSeconds)
        assertEquals("2023-11-14T22:13:20.000Z", clock.iso)

        val now = TimestampToolProjection.nowFieldValues(reference)
        assertEquals("1700000000", now.unix)
        assertEquals("2023-11-14T22:13:20.000Z", now.iso)
    }

    // ── unix parse (web `unix.length > 10 ? parseInt : parseInt * 1000` + new Date) ──

    @Test
    fun parseUnixTreatsTenDigitsOrFewerAsSeconds() {
        // "1700000000".length == 10, not > 10 → seconds → ×1000.
        assertEquals(reference, TimestampToolProjection.parseUnix("1700000000"))
    }

    @Test
    fun parseUnixTreatsMoreThanTenDigitsAsMilliseconds() {
        // "1700000000000".length == 13 > 10 → milliseconds.
        assertEquals(reference, TimestampToolProjection.parseUnix("1700000000000"))
    }

    @Test
    fun parseUnixFollowsJsParseIntLeadingDigitSemantics() {
        // parseInt("123abc", 10) === 123; length 6 ≤ 10 → seconds → 123 s.
        assertEquals(Instant.ofEpochSecond(123L), TimestampToolProjection.parseUnix("123abc"))
        // Leading whitespace + sign, like parseInt("  +42").
        assertEquals(Instant.ofEpochSecond(42L), TimestampToolProjection.parseUnix("  +42"))
    }

    @Test
    fun parseUnixReturnsNullForEmptyOrNonNumericInput() {
        assertNull(TimestampToolProjection.parseUnix(""))
        assertNull(TimestampToolProjection.parseUnix("abc"))
        assertNull(TimestampToolProjection.parseUnix("   "))
    }

    @Test
    fun parseUnixReturnsNullWhenOutOfTheJsDateRange() {
        // |ms| > 8.64e15 makes new Date(ms) invalid (NaN) in JS → null here.
        assertNull(TimestampToolProjection.parseUnix("99999999999999999999"))
    }

    // ── iso parse (web `new Date(iso)`) ──────────────────────────────────────────────

    @Test
    fun parseIsoAcceptsInstantOffsetLocalAndDateOnlyForms() {
        assertEquals(Instant.parse("2024-01-01T00:00:00Z"), TimestampToolProjection.parseIso("2024-01-01T00:00:00Z", utc))
        assertEquals(Instant.parse("2024-01-01T00:00:00Z"), TimestampToolProjection.parseIso("2024-01-01T00:00:00.000Z", utc))
        // +05:30 offset resolves to the prior UTC evening.
        assertEquals(
            Instant.parse("2023-12-31T18:30:00Z"),
            TimestampToolProjection.parseIso("2024-01-01T00:00:00+05:30", utc),
        )
        // Zoneless local date-time is interpreted in the supplied zone (web local time).
        assertEquals(
            Instant.parse("2024-01-01T12:00:00Z"),
            TimestampToolProjection.parseIso("2024-01-01T12:00:00", utc),
        )
    }

    @Test
    fun parseIsoTreatsDateOnlyAsUtcMidnightRegardlessOfZone() {
        // JS `new Date('2024-01-01')` is UTC midnight even in a negative-offset zone.
        assertEquals(
            Instant.parse("2024-01-01T00:00:00Z"),
            TimestampToolProjection.parseIso("2024-01-01", ZoneId.of("America/Los_Angeles")),
        )
    }

    @Test
    fun parseIsoReturnsNullForEmptyOrUnparseableInput() {
        assertNull(TimestampToolProjection.parseIso("", utc))
        assertNull(TimestampToolProjection.parseIso("not-a-date", utc))
    }

    // ── relative time (web getRelativeTime: abs diff, Xs/Xm/Xh/Xd ago) ───────────────

    @Test
    fun relativeUsesSecondsMinutesHoursDaysBuckets() {
        val now = Instant.ofEpochSecond(2_000_000_000L)
        assertEquals("30s ago", TimestampToolProjection.relative(now.minusSeconds(30L), now))
        assertEquals("59s ago", TimestampToolProjection.relative(now.minusSeconds(59L), now))
        assertEquals("1m ago", TimestampToolProjection.relative(now.minusSeconds(60L), now))
        assertEquals("5m ago", TimestampToolProjection.relative(now.minusSeconds(300L), now))
        assertEquals("3h ago", TimestampToolProjection.relative(now.minusSeconds(3L * 3600L), now))
        assertEquals("2d ago", TimestampToolProjection.relative(now.minusSeconds(2L * 86_400L), now))
    }

    @Test
    fun relativeUsesAbsoluteDifferenceSoAFutureInstantStillReadsAgo() {
        // Web getRelativeTime uses Math.abs, so a future instant is reported as "… ago" too.
        val now = Instant.ofEpochSecond(2_000_000_000L)
        assertEquals("45s ago", TimestampToolProjection.relative(now.plusSeconds(45L), now))
    }

    // ── local (web formatDateTime → toLocaleString) ──────────────────────────────────

    @Test
    fun localRendersTheLocaleAwareDateTimeFields() {
        // Robust against CLDR spacing/abbreviation variance: assert the field structure, not an exact byte string.
        val pm = TimestampToolProjection.local(reference, utc, us)
        assertTrue("expected the date prefix, was: $pm", pm.startsWith("Nov 14, 2023,"))
        assertTrue("expected the 24h→12h evening time, was: $pm", pm.contains("10:13"))
        assertTrue("expected a PM meridiem, was: $pm", pm.endsWith("PM"))

        val am = TimestampToolProjection.local(Instant.parse("2024-01-01T00:00:00Z"), utc, us)
        assertTrue("expected midnight as 12:00, was: $am", am.startsWith("Jan 1, 2024,") && am.contains("12:00"))
        assertTrue("expected an AM meridiem, was: $am", am.endsWith("AM"))
    }

    // ── full per-input projections (web {fromUnix && …} / {fromIso && …}) ─────────────

    @Test
    fun projectUnixBuildsIsoLocalAndRelativeRowsForAParseableInput() {
        val now = reference.plusSeconds(3600L)
        val conversion = TimestampToolProjection.projectUnix("1700000000", now, utc, us)
        requireNotNull(conversion)
        assertEquals("2023-11-14T22:13:20.000Z", conversion.iso)
        assertTrue("expected the local date, was: ${conversion.local}", conversion.local.startsWith("Nov 14, 2023,"))
        assertEquals("1h ago", conversion.relative)
    }

    @Test
    fun projectUnixReturnsNullForAnUnparseableInput() {
        assertNull(TimestampToolProjection.projectUnix("", reference, utc, us))
        assertNull(TimestampToolProjection.projectUnix("nope", reference, utc, us))
    }

    @Test
    fun projectIsoBuildsUnixLocalAndRelativeRowsForAParseableInput() {
        val now = Instant.parse("2024-01-01T00:00:00Z").plusSeconds(120L)
        val conversion = TimestampToolProjection.projectIso("2024-01-01T00:00:00Z", now, utc, us)
        requireNotNull(conversion)
        assertEquals("1704067200", conversion.unix)
        assertTrue("expected the local date, was: ${conversion.local}", conversion.local.startsWith("Jan 1, 2024,"))
        assertEquals("2m ago", conversion.relative)
    }

    @Test
    fun projectIsoReturnsNullForAnUnparseableInput() {
        assertNull(TimestampToolProjection.projectIso("", reference, utc, us))
        assertNull(TimestampToolProjection.projectIso("not-a-date", reference, utc, us))
    }
}
