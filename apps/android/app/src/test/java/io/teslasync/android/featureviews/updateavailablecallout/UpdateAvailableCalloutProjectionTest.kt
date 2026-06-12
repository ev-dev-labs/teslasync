package io.teslasync.android.featureviews.updateavailablecallout

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the UpdateAvailableCallout's pure logic — the native mirror of every derivation
 * the web component performs (web/src/features/system/components/status/UpdateAvailableCallout.tsx): the
 * `latest`/`current` truthiness checks that gate the version suffix and the "running" line, and the
 * `formatDateTime(checkedAt)` call behind the "last checked" tail. Because the surface is purely
 * presentational, each [UpdateAvailableCalloutDisplay] is exactly what the thin composable renders, so the
 * per-branch assertions double as the "snapshot". Runs in the :app:testReleaseUnitTest gate.
 */
class UpdateAvailableCalloutProjectionTest {
    private companion object {
        val UTC: ZoneId = ZoneId.of("UTC")
        val LOCALE: Locale = Locale.US

        // 2026-04-04T21:30:00Z rendered in UTC reads "Apr 4, 2026, 9:30 PM" in en-US.
        const val CHECKED_AT_UTC = "2026-04-04T21:30:00Z"

        // The same instant expressed with a +02:00 offset (23:30 local) must format identically.
        const val CHECKED_AT_OFFSET = "2026-04-04T23:30:00+02:00"
    }

    private fun project(
        current: String?,
        latest: String?,
        checkedAt: String?,
    ): UpdateAvailableCalloutDisplay = UpdateAvailableCalloutProjection.project(current, latest, checkedAt, UTC, LOCALE)

    // ── normalize: web truthiness on an optional string prop ────────────────────────────────────────

    @Test
    fun normalizeTreatsNullBlankAndWhitespaceAsAbsent() {
        assertNull(UpdateAvailableCalloutProjection.normalize(null))
        assertNull(UpdateAvailableCalloutProjection.normalize(""))
        assertNull(UpdateAvailableCalloutProjection.normalize("   "))
        assertNull(UpdateAvailableCalloutProjection.normalize("\t\n"))
    }

    @Test
    fun normalizeTrimsAPresentValue() {
        assertEquals("2026.12.0", UpdateAvailableCalloutProjection.normalize("  2026.12.0 "))
        assertEquals("2026.8.1", UpdateAvailableCalloutProjection.normalize("2026.8.1"))
    }

    // ── project: the per-branch "snapshot" (every branch the surface renders) ───────────────────────

    @Test
    fun projectFullInputCarriesEveryBranch() {
        val display = project(current = "2026.8.1", latest = "2026.12.0", checkedAt = CHECKED_AT_UTC)
        assertEquals("2026.12.0", display.latestVersion)
        assertEquals("2026.8.1", display.currentVersion)
        assertTrue(display.showVersionInTitle)
        assertTrue(display.showRunningLine)
        assertTrue(display.showLastChecked)
        // The formatted tail is a real localized timestamp, not the em-dash fallback.
        val label = requireNotNull(display.checkedAtLabel)
        assertNotEquals(UpdateAvailableCalloutProjection.FALLBACK, label)
        assertTrue(label.contains("2026"))
        assertTrue(label.contains("9:30"))
    }

    @Test
    fun projectWithoutLatestDropsOnlyTheVersionSuffix() {
        val display = project(current = "2026.8.1", latest = null, checkedAt = null)
        assertNull(display.latestVersion)
        assertFalse(display.showVersionInTitle)
        // The "running" line still renders; the body sentence (composable) is always present.
        assertEquals("2026.8.1", display.currentVersion)
        assertTrue(display.showRunningLine)
        assertFalse(display.showLastChecked)
    }

    @Test
    fun projectWithoutCurrentDropsOnlyTheRunningLine() {
        val display = project(current = "  ", latest = "2026.12.0", checkedAt = CHECKED_AT_UTC)
        // A blank current is web-falsy → absent.
        assertNull(display.currentVersion)
        assertFalse(display.showRunningLine)
        assertTrue(display.showVersionInTitle)
        assertTrue(display.showLastChecked)
    }

    @Test
    fun projectWithBlankCheckedAtHidesTheLastCheckedTail() {
        val display = project(current = "2026.8.1", latest = "2026.12.0", checkedAt = "   ")
        assertNull(display.checkedAtLabel)
        assertFalse(display.showLastChecked)
    }

    @Test
    fun projectAllAbsentStillProducesARenderableCallout() {
        // Web: even with no props the body sentence renders, so the surface is never a blank box.
        val display = project(current = null, latest = null, checkedAt = null)
        assertNull(display.latestVersion)
        assertNull(display.currentVersion)
        assertNull(display.checkedAtLabel)
        assertFalse(display.showVersionInTitle)
        assertFalse(display.showRunningLine)
        assertFalse(display.showLastChecked)
    }

    // ── formatDateTime: web `formatDateTime(checkedAt)` (localized date + minute-precision time) ─────

    @Test
    fun formatDateTimeRendersLocalizedDateAndTime() {
        val label = UpdateAvailableCalloutProjection.formatDateTime(CHECKED_AT_UTC, UTC, LOCALE)
        assertNotEquals(UpdateAvailableCalloutProjection.FALLBACK, label)
        assertTrue("expected the year", label.contains("2026"))
        assertTrue("expected the day", label.contains("4"))
        assertTrue("expected minute-precision time", label.contains("9:30"))
    }

    @Test
    fun formatDateTimeReadsAnOffsetStampToTheSameInstant() {
        val utc = UpdateAvailableCalloutProjection.formatDateTime(CHECKED_AT_UTC, UTC, LOCALE)
        val offset = UpdateAvailableCalloutProjection.formatDateTime(CHECKED_AT_OFFSET, UTC, LOCALE)
        assertEquals(utc, offset)
    }

    @Test
    fun formatDateTimeRendersTheStampInTheRequestedZone() {
        // 21:30Z is 14:30 (2:30 PM) in Los Angeles — the injected zone drives the rendered time.
        val la = UpdateAvailableCalloutProjection.formatDateTime(CHECKED_AT_UTC, ZoneId.of("America/Los_Angeles"), LOCALE)
        assertTrue("expected the zone-shifted time", la.contains("2:30"))
    }

    @Test
    fun formatDateTimeFallsBackToEmDashForUnparseableInput() {
        assertEquals(UpdateAvailableCalloutProjection.FALLBACK, UpdateAvailableCalloutProjection.formatDateTime("not-a-date", UTC, LOCALE))
        assertEquals(UpdateAvailableCalloutProjection.FALLBACK, UpdateAvailableCalloutProjection.formatDateTime("", UTC, LOCALE))
    }

    @Test
    fun projectFormatsAnUnparseableCheckedAtAsTheFallbackButStillShowsTheTail() {
        // Web renders "· Last checked —" when checkedAt is present but unparseable (truthy string, invalid date).
        val display = project(current = null, latest = null, checkedAt = "garbage")
        assertEquals(UpdateAvailableCalloutProjection.FALLBACK, display.checkedAtLabel)
        assertTrue(display.showLastChecked)
    }
}
