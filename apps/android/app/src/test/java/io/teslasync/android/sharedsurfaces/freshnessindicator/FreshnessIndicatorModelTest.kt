package io.teslasync.android.sharedsurfaces.freshnessindicator

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the FreshnessIndicator's pure logic — the native mirror of every decision the
 * web component makes (web/src/components/data-display/FreshnessIndicator.tsx): `computeAge` (floor at 0,
 * `null` when absent), the fresh / stale / offline / unknown `getStatus` ternary, the `formatAge` relative
 * bucket cutoffs, the `useIsStale` reduction (with its HARDCODED 600s offline window), and the accessible
 * description selection. Because the composable is a thin render layer over [projectFreshnessIndicator], the
 * per-branch assertions here double as the surface's per-state snapshot and its a11y-label test. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class FreshnessIndicatorModelTest {
    // ── computeAge (web `Math.max(0, Math.floor((Date.now() - timestamp) / 1000))`, null when absent) ──────

    @Test
    fun ageIsNullWhenThereIsNoTimestamp() {
        assertNull(freshnessAgeSeconds(null, NOW))
    }

    @Test
    fun ageIsWholeSecondsSinceTheTimestamp() {
        assertEquals(5L, freshnessAgeSeconds(NOW - 5_000L, NOW))
        assertEquals(200L, freshnessAgeSeconds(NOW - 200_000L, NOW))
    }

    @Test
    fun ageFloorsSubSecondDeltasAndClampsTheFutureToZero() {
        assertEquals("sub-second floors down", 0L, freshnessAgeSeconds(NOW - 999L, NOW))
        assertEquals("exactly now is zero", 0L, freshnessAgeSeconds(NOW, NOW))
        assertEquals("a future timestamp clamps to zero", 0L, freshnessAgeSeconds(NOW + 5_000L, NOW))
    }

    // ── getStatus (web fresh / stale / offline / unknown ternary) ─────────────────────────────────────────

    @Test
    fun statusIsUnknownWithoutAnAge() {
        assertEquals(FreshnessStatus.Unknown, freshnessStatus(null))
    }

    @Test
    fun statusCrossesAtTheStaleAndOfflineThresholds() {
        assertEquals(FreshnessStatus.Fresh, freshnessStatus(0L))
        assertEquals("just under stale is still fresh", FreshnessStatus.Fresh, freshnessStatus(119L))
        assertEquals("at the stale threshold flips to stale", FreshnessStatus.Stale, freshnessStatus(120L))
        assertEquals("just under offline is still stale", FreshnessStatus.Stale, freshnessStatus(599L))
        assertEquals("at the offline threshold flips to offline", FreshnessStatus.Offline, freshnessStatus(600L))
    }

    // ── formatAge (web `< 10` just-now, `< 60` seconds, `< 3600` minutes, else hours) ─────────────────────

    @Test
    fun ageLabelIsUnknownWithoutAnAge() {
        assertEquals(FreshnessAgeLabel.Unknown, freshnessAgeLabel(null))
    }

    @Test
    fun ageLabelBucketsMatchTheWebCutoffs() {
        assertEquals(FreshnessAgeLabel.JustNow, freshnessAgeLabel(0L))
        assertEquals("just under 10s is still just-now", FreshnessAgeLabel.JustNow, freshnessAgeLabel(9L))
        assertEquals("10s shows raw seconds", FreshnessAgeLabel.Seconds(10L), freshnessAgeLabel(10L))
        assertEquals("59s shows raw seconds", FreshnessAgeLabel.Seconds(59L), freshnessAgeLabel(59L))
        assertEquals("60s floors to 1 minute", FreshnessAgeLabel.Minutes(1L), freshnessAgeLabel(60L))
        assertEquals("3599s floors to 59 minutes", FreshnessAgeLabel.Minutes(59L), freshnessAgeLabel(3_599L))
        assertEquals("3600s floors to 1 hour", FreshnessAgeLabel.Hours(1L), freshnessAgeLabel(3_600L))
        assertEquals("7200s floors to 2 hours", FreshnessAgeLabel.Hours(2L), freshnessAgeLabel(7_200L))
    }

    // ── useIsStale (web `isStale = age >= staleThreshold`, `isOffline = age >= 600` HARDCODED) ─────────────

    @Test
    fun stalenessIsAllFalseAndUnknownWithoutATimestamp() {
        val staleness = freshnessStaleness(null, NOW)
        assertFalse(staleness.isStale)
        assertFalse(staleness.isOffline)
        assertEquals(FreshnessAgeLabel.Unknown, staleness.ageLabel)
    }

    @Test
    fun stalenessUsesTheCallerStaleThresholdButAFixedOfflineWindow() {
        val stale = freshnessStaleness(NOW - 130_000L, NOW, staleThresholdSeconds = 120L)
        assertTrue("130s is past the 120s stale threshold", stale.isStale)
        assertFalse("130s is not yet offline (< 600s)", stale.isOffline)
        assertEquals(FreshnessAgeLabel.Minutes(2L), stale.ageLabel)

        val offline = freshnessStaleness(NOW - 700_000L, NOW)
        assertTrue(offline.isStale)
        assertTrue("700s is past the 600s offline window", offline.isOffline)
        assertEquals(FreshnessAgeLabel.Minutes(11L), offline.ageLabel)
    }

    @Test
    fun offlineFlagIgnoresTheCallerThresholdAndStaysPinnedTo600() {
        // staleThreshold raised above the age: not stale, yet still offline because isOffline is keyed off the
        // fixed 600s window (web `age >= 600`), not the caller threshold.
        val staleness = freshnessStaleness(NOW - 620_000L, NOW, staleThresholdSeconds = 650L)
        assertFalse("620s is under the raised 650s stale threshold", staleness.isStale)
        assertTrue("620s is still past the fixed 600s offline window", staleness.isOffline)
    }

    // ── accessible description selection (a11y-label test) ────────────────────────────────────────────────

    @Test
    fun a11yIsNeverUpdatedForUnknownAndFreshnessOtherwise() {
        assertEquals(FreshnessA11y.NeverUpdated, freshnessA11y(FreshnessStatus.Unknown, FreshnessAgeLabel.Unknown))
        assertEquals(
            FreshnessA11y.Freshness(FreshnessAgeLabel.JustNow),
            freshnessA11y(FreshnessStatus.Fresh, FreshnessAgeLabel.JustNow),
        )
        assertEquals(
            FreshnessA11y.Freshness(FreshnessAgeLabel.Minutes(11L)),
            freshnessA11y(FreshnessStatus.Offline, FreshnessAgeLabel.Minutes(11L)),
        )
    }

    // ── full projection: the per-state snapshot (fresh / stale / offline / unknown) ───────────────────────

    @Test
    fun projectionReducesEverySurfaceState() {
        assertEquals(
            "fresh: green dot, just-now label, spoken recency",
            FreshnessIndicatorProjection(
                status = FreshnessStatus.Fresh,
                ageLabel = FreshnessAgeLabel.JustNow,
                a11y = FreshnessA11y.Freshness(FreshnessAgeLabel.JustNow),
            ),
            projectFreshnessIndicator(NOW - 5_000L, NOW),
        )
        assertEquals(
            "stale: amber dot, minutes label",
            FreshnessIndicatorProjection(
                status = FreshnessStatus.Stale,
                ageLabel = FreshnessAgeLabel.Minutes(3L),
                a11y = FreshnessA11y.Freshness(FreshnessAgeLabel.Minutes(3L)),
            ),
            projectFreshnessIndicator(NOW - 200_000L, NOW),
        )
        assertEquals(
            "offline: red dot, minutes label",
            FreshnessIndicatorProjection(
                status = FreshnessStatus.Offline,
                ageLabel = FreshnessAgeLabel.Minutes(11L),
                a11y = FreshnessA11y.Freshness(FreshnessAgeLabel.Minutes(11L)),
            ),
            projectFreshnessIndicator(NOW - 700_000L, NOW),
        )
        assertEquals(
            "unknown: muted dot, em-dash label, never-updated a11y",
            FreshnessIndicatorProjection(
                status = FreshnessStatus.Unknown,
                ageLabel = FreshnessAgeLabel.Unknown,
                a11y = FreshnessA11y.NeverUpdated,
            ),
            projectFreshnessIndicator(null, NOW),
        )
    }

    private companion object {
        /** A fixed "now" so age math is deterministic without reading the wall clock. */
        const val NOW: Long = 1_700_000_000_000
    }
}
