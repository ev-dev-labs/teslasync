package io.teslasync.android.featureviews.helpers

import io.teslasync.android.components.ui.BadgeVariant
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the `helpers` module's pure logic — the native mirror of every branch the web
 * status helpers define (web/src/features/system/components/status/helpers.tsx): the four status buckets
 * (shared by `getStatusColor` / `statusTextClass` / `getStatusIcon`), the `statusToBadgeVariant` switch (with
 * its `connected` asymmetry), and the `formatUptime` / `formatBytes` formatters. Because the surface is
 * purely derivational, each resolved value is exactly what the thin composable renders, so these assertions
 * double as the per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class HelpersModelTest {
    // ── Status classification: color/icon set (web `getStatusColor` / `getStatusIcon`) ──────────────────

    @Test
    fun fromStatusClassifiesEverySuccessTokenIncludingConnected() {
        val success = listOf("healthy", "ok", "online", "connected", "ready", "sent", "completed")
        success.forEach { assertEquals("'$it' is success", StatusKind.Success, StatusKind.fromStatus(it)) }
    }

    @Test
    fun fromStatusClassifiesWarningAndDangerTokens() {
        listOf("degraded", "warning", "pending", "queued", "processing")
            .forEach { assertEquals("'$it' is warning", StatusKind.Warning, StatusKind.fromStatus(it)) }
        listOf("unhealthy", "offline", "error", "down", "failed")
            .forEach { assertEquals("'$it' is danger", StatusKind.Danger, StatusKind.fromStatus(it)) }
    }

    @Test
    fun fromStatusFallsThroughToNeutralForUnknownNullAndBlank() {
        assertEquals(StatusKind.Neutral, StatusKind.fromStatus("syncing"))
        assertEquals(StatusKind.Neutral, StatusKind.fromStatus(""))
        assertEquals(StatusKind.Neutral, StatusKind.fromStatus(null))
    }

    @Test
    fun fromStatusIsCaseInsensitiveLikeToLowerCase() {
        assertEquals(StatusKind.Success, StatusKind.fromStatus("HEALTHY"))
        assertEquals(StatusKind.Warning, StatusKind.fromStatus("Degraded"))
        assertEquals(StatusKind.Danger, StatusKind.fromStatus("ERROR"))
    }

    // ── Status classification: badge set (web `statusToBadgeVariant`) + the `connected` asymmetry pin ────

    @Test
    fun forBadgeExcludesConnectedFromSuccess() {
        // The faithful web asymmetry: `connected` is success for color/icon but NOT for the badge variant.
        assertEquals(StatusKind.Success, StatusKind.fromStatus("connected"))
        assertEquals(StatusKind.Neutral, StatusKind.forBadge("connected"))
    }

    @Test
    fun forBadgeMatchesTheRemainingBucketsLikeFromStatus() {
        listOf("healthy", "ok", "online", "ready", "sent", "completed")
            .forEach { assertEquals("'$it' badge success", StatusKind.Success, StatusKind.forBadge(it)) }
        assertEquals(StatusKind.Warning, StatusKind.forBadge("queued"))
        assertEquals(StatusKind.Danger, StatusKind.forBadge("failed"))
        assertEquals(StatusKind.Neutral, StatusKind.forBadge("unknown"))
    }

    @Test
    fun statusBadgeVariantMapsEachBucketToItsMaterialVariant() {
        assertEquals(BadgeVariant.Success, statusBadgeVariant("completed"))
        assertEquals(BadgeVariant.Warning, statusBadgeVariant("processing"))
        assertEquals(BadgeVariant.Danger, statusBadgeVariant("down"))
        assertEquals(BadgeVariant.Neutral, statusBadgeVariant("unknown"))
        // The asymmetry surfaces through the public mapper too.
        assertEquals(BadgeVariant.Neutral, statusBadgeVariant("connected"))
    }

    // ── formatUptime (web floor into days/hours/minutes, largest non-zero tier down) ─────────────────────

    @Test
    fun formatUptimeRendersTheMinutesOnlyTier() {
        assertEquals("0m", HelpersFormat.formatUptime(0L))
        assertEquals("0m", HelpersFormat.formatUptime(59L))
        assertEquals("1m", HelpersFormat.formatUptime(60L))
        assertEquals("59m", HelpersFormat.formatUptime(3_599L))
    }

    @Test
    fun formatUptimeRendersTheHoursTier() {
        assertEquals("1h 0m", HelpersFormat.formatUptime(3_600L))
        assertEquals("1h 1m", HelpersFormat.formatUptime(3_661L))
        assertEquals("23h 59m", HelpersFormat.formatUptime(86_399L))
    }

    @Test
    fun formatUptimeRendersTheDaysTier() {
        assertEquals("1d 0h 0m", HelpersFormat.formatUptime(86_400L))
        assertEquals("1d 1h 1m", HelpersFormat.formatUptime(90_061L))
        assertEquals("10d 0h 0m", HelpersFormat.formatUptime(864_000L))
    }

    @Test
    fun formatUptimeClampsNegativeInputToZero() {
        // Uptime is non-negative; the domain never produces a negative, and a clamp keeps tiers non-negative.
        assertEquals("0m", HelpersFormat.formatUptime(-10L))
    }

    // ── formatBytes (web `0 B`, else binary unit + `fmtNumber(_, 1)` with locale grouping) ───────────────

    @Test
    fun formatBytesRendersZeroWithoutAFractionDigit() {
        assertEquals("0 B", HelpersFormat.formatBytes(0L, Locale.US))
    }

    @Test
    fun formatBytesScalesThroughEachBinaryUnit() {
        assertEquals("512.0 B", HelpersFormat.formatBytes(512L, Locale.US))
        assertEquals("1.0 KB", HelpersFormat.formatBytes(1_024L, Locale.US))
        assertEquals("1.5 KB", HelpersFormat.formatBytes(1_536L, Locale.US))
        assertEquals("1.0 MB", HelpersFormat.formatBytes(1_048_576L, Locale.US))
        assertEquals("1.0 GB", HelpersFormat.formatBytes(1_073_741_824L, Locale.US))
        assertEquals("1.0 TB", HelpersFormat.formatBytes(1_099_511_627_776L, Locale.US))
    }

    @Test
    fun formatBytesGroupsThousandsWithinAUnitPerLocale() {
        // 1023 stays in bytes; `fmtNumber(1023, 1)` is locale-grouped, so US shows a comma separator.
        assertEquals("1,023.0 B", HelpersFormat.formatBytes(1_023L, Locale.US))
        // German locale groups with "." and uses "," as the decimal separator.
        assertEquals("1,5 KB", HelpersFormat.formatBytes(1_536L, Locale.GERMANY))
    }

    @Test
    fun formatBytesHardensTheDegenerateEdges() {
        // Non-positive byte count → "0 B" (the web leaves negatives undefined; a byte count is unsigned).
        assertEquals("0 B", HelpersFormat.formatBytes(-5L, Locale.US))
        // Beyond TB the exponent is clamped to TB (the web would index past `sizes` and emit "undefined").
        val fivePetabytes = 5L * 1_024L * 1_024L * 1_024L * 1_024L * 1_024L
        assertEquals("5,120.0 TB", HelpersFormat.formatBytes(fivePetabytes, Locale.US))
    }

    // ── fmtNumber (web `fmtNumber`: safeNumber + locale grouping + HALF_UP) ───────────────────────────────

    @Test
    fun fmtNumberRoundsHalvesAwayFromZeroLikeIntlNumberFormat() {
        // 1.25 → 1.3 under HALF_UP (Intl halfExpand); the JVM default HALF_EVEN would give 1.2.
        assertEquals("1.3", HelpersFormat.fmtNumber(1.25, 1, Locale.US))
        assertEquals("1.2", HelpersFormat.fmtNumber(1.24, 1, Locale.US))
    }

    @Test
    fun fmtNumberGuardsNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.0", HelpersFormat.fmtNumber(Double.NaN, 1, Locale.US))
        assertEquals("0.0", HelpersFormat.fmtNumber(Double.POSITIVE_INFINITY, 1, Locale.US))
    }

    @Test
    fun fmtNumberGroupsThousandsPerLocale() {
        assertEquals("1,234.5", HelpersFormat.fmtNumber(1_234.5, 1, Locale.US))
        assertEquals("1.234,5", HelpersFormat.fmtNumber(1_234.5, 1, Locale.GERMANY))
    }
}
