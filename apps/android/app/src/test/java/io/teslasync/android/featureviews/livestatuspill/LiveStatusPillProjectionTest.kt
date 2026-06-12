package io.teslasync.android.featureviews.livestatuspill

import io.teslasync.android.components.datadisplay.FreshnessAge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveStatusPill's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/system/components/status/LiveStatusPill.tsx): the `TONE[state]` lookup
 * (color / icon / pulse), the `relative(now, lastUpdateAt)` bucketing, and the `role="status"` accessibility
 * label. Because the surface is purely presentational, each [LiveStatusPillDisplay] is exactly what the thin
 * composable renders, so the per-state assertions double as the "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class LiveStatusPillProjectionTest {
    private companion object {
        const val NOW: Long = 2_000_000_000_000L
        const val MILLIS_PER_SECOND: Long = 1_000L
    }

    /** The web `relative()` age for a stamp [secondsAgo] seconds before [NOW]. */
    private fun ageAt(secondsAgo: Long): FreshnessAge = LiveStatusPillProjection.relativeAge(NOW, NOW - secondsAgo * MILLIS_PER_SECOND)

    // ── relative() bucketing (web `<5s` just-now, `<60s` s, `<1h` m, else h) ────────────────────────

    @Test
    fun relativeAgeOfNullStampIsUnknown() {
        // Web `if (lastUpdateAt == null) return '—'` — the composable renders this as the em dash.
        assertEquals(FreshnessAge.Unknown, LiveStatusPillProjection.relativeAge(NOW, null))
    }

    @Test
    fun relativeAgeUnderFiveSecondsIsJustNow() {
        // Web `if (secs < 5) return 'just now'` — the surface's own cutoff (tighter than the shared 10s window).
        assertEquals(FreshnessAge.JustNow, ageAt(0))
        assertEquals(FreshnessAge.JustNow, ageAt(4))
        // 4.999s floors to 4 (web `Math.floor`) — still just-now.
        assertEquals(FreshnessAge.JustNow, LiveStatusPillProjection.relativeAge(NOW, NOW - 4_999L))
    }

    @Test
    fun relativeAgeBetweenFiveAndSixtySecondsIsSeconds() {
        assertEquals(FreshnessAge.Seconds(5L), ageAt(5))
        assertEquals(FreshnessAge.Seconds(42L), ageAt(42))
        assertEquals(FreshnessAge.Seconds(59L), ageAt(59))
        // 5.001s floors to 5 — the first second past the just-now cutoff.
        assertEquals(FreshnessAge.Seconds(5L), LiveStatusPillProjection.relativeAge(NOW, NOW - 5_001L))
    }

    @Test
    fun relativeAgeBetweenOneMinuteAndOneHourIsMinutes() {
        assertEquals(FreshnessAge.Minutes(1L), ageAt(60))
        assertEquals(FreshnessAge.Minutes(5L), ageAt(5 * 60))
        assertEquals(FreshnessAge.Minutes(59L), ageAt(3_599))
    }

    @Test
    fun relativeAgeAtOrAboveOneHourIsHoursAndNeverRollsToDays() {
        assertEquals(FreshnessAge.Hours(1L), ageAt(3_600))
        // Web caps at hours: a 30-hour-old stream reads "30h ago", never "1d ago".
        assertEquals(FreshnessAge.Hours(30L), ageAt(30 * 3_600))
        val weekOld = ageAt(7 * 24 * 3_600)
        assertEquals(FreshnessAge.Hours(168L), weekOld)
        assertTrue("a multi-day age must stay an Hours bucket", weekOld is FreshnessAge.Hours)
    }

    @Test
    fun relativeAgeClampsAFutureStampToJustNow() {
        // Web `Math.max(0, …)` — a stamp ahead of `now` (clock skew) is treated as age 0.
        assertEquals(FreshnessAge.JustNow, LiveStatusPillProjection.relativeAge(NOW, NOW + 5 * MILLIS_PER_SECOND))
    }

    // ── pulse (web `tone.pulse`) ────────────────────────────────────────────────────────────────────

    @Test
    fun shouldPulseOnlyWhileReconnecting() {
        assertTrue(LiveStatusPillProjection.shouldPulse(LiveStatusState.Reconnecting))
        assertFalse(LiveStatusPillProjection.shouldPulse(LiveStatusState.Live))
        assertFalse(LiveStatusPillProjection.shouldPulse(LiveStatusState.Offline))
    }

    // ── project: the per-state "snapshot" (every state the surface renders) ─────────────────────────

    @Test
    fun projectLiveCarriesGreenStateFreshAgeAndNoPulse() {
        val display = LiveStatusPillProjection.project(LiveStatusState.Live, NOW, NOW - 3 * MILLIS_PER_SECOND)
        assertEquals(LiveStatusState.Live, display.state)
        assertEquals(FreshnessAge.JustNow, display.age)
        assertFalse(display.pulse)
    }

    @Test
    fun projectReconnectingCarriesTheAgeAndPulses() {
        val display = LiveStatusPillProjection.project(LiveStatusState.Reconnecting, NOW, NOW - 42 * MILLIS_PER_SECOND)
        assertEquals(LiveStatusState.Reconnecting, display.state)
        assertEquals(FreshnessAge.Seconds(42L), display.age)
        assertTrue(display.pulse)
    }

    @Test
    fun projectOfflineCarriesTheAgeAndDoesNotPulse() {
        val display = LiveStatusPillProjection.project(LiveStatusState.Offline, NOW, NOW - 5_400_000L)
        assertEquals(LiveStatusState.Offline, display.state)
        assertEquals(FreshnessAge.Hours(1L), display.age)
        assertFalse(display.pulse)
    }

    // ── wire token (web `data-status-live-state` + the SSE hook union) ──────────────────────────────

    @Test
    fun fromWireMapsTheKnownTokensVerbatim() {
        assertEquals(LiveStatusState.Live, LiveStatusState.fromWire("live"))
        assertEquals(LiveStatusState.Reconnecting, LiveStatusState.fromWire("reconnecting"))
        assertEquals(LiveStatusState.Offline, LiveStatusState.fromWire("offline"))
    }

    @Test
    fun fromWireFallsBackToOfflineForAnUnknownToken() {
        // The safe "not live" posture — an unrecognized stream token is never painted as connected.
        assertEquals(LiveStatusState.Offline, LiveStatusState.fromWire("boom"))
        assertEquals(LiveStatusState.Offline, LiveStatusState.fromWire(""))
        assertEquals(LiveStatusState.Offline, LiveStatusState.fromWire("LIVE"))
    }

    @Test
    fun wireTokenRoundTripsThroughFromWire() {
        assertEquals("live", LiveStatusState.Live.wire)
        assertEquals("reconnecting", LiveStatusState.Reconnecting.wire)
        assertEquals("offline", LiveStatusState.Offline.wire)
        for (state in LiveStatusState.entries) {
            assertEquals(state, LiveStatusState.fromWire(state.wire))
        }
    }

    // ── accessibility label (web `role="status"` + `aria-label`) ────────────────────────────────────

    @Test
    fun contentDescriptionJoinsTheLocalizedLabelAndFreshnessPhrase() {
        val description = LiveStatusPillProjection.contentDescription("Live", "Last updated: 5s ago")
        assertEquals("Live. Last updated: 5s ago", description)
        assertTrue("the state label must be present", description.contains("Live"))
        assertTrue("the freshness phrase must be present", description.contains("Last updated: 5s ago"))
    }
}
