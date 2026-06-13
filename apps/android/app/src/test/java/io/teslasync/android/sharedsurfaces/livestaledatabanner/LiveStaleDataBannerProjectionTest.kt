package io.teslasync.android.sharedsurfaces.livestaledatabanner

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveStaleDataBanner pure adapter — the native mirror of every decision the web
 * `LiveStaleDataBanner` makes between a `useLiveConnection()` result and the rendered (or absent) banner
 * (web/src/components/feedback/LiveStaleDataBanner.tsx): the `disconnectedSinceRef` stamp + clear, the two-minute
 * `show` threshold (including the exact boundary), and the hidden states for every healthy / cold-start /
 * within-window case. Because the composable is a thin render layer over [LiveStaleDataBannerProjection], the
 * per-branch assertions here double as the surface's per-state "snapshot". Runs in the :android:testReleaseUnitTest
 * gate.
 */
class LiveStaleDataBannerProjectionTest {
    private val base = 1_700_000_000_000L
    private val twoMinutes = STALE_BANNER_THRESHOLD_MILLIS

    private fun state(
        status: LiveConnectionStatus,
        disconnectedSinceMillis: Long? = null,
    ) = StaleBannerState(status, disconnectedSinceMillis)

    // ── fold: the web disconnectedSinceRef stamp + clear ──────────────────────────────────────────────────────

    @Test
    fun foldStampsTheDisconnectionClockOnTheFirstDisconnect() {
        val next = LiveStaleDataBannerProjection.fold(StaleBannerState.initial(), LiveConnectionStatus.Disconnected, base)
        assertEquals(LiveConnectionStatus.Disconnected, next.status)
        assertEquals(base, next.disconnectedSinceMillis)
    }

    @Test
    fun foldKeepsTheOriginalDisconnectionClockWhileStillDisconnected() {
        val first = LiveStaleDataBannerProjection.fold(StaleBannerState.initial(), LiveConnectionStatus.Disconnected, base)
        val later =
            LiveStaleDataBannerProjection.fold(first, LiveConnectionStatus.Disconnected, base + twoMinutes)
        assertEquals("the web ref is set once and left", base, later.disconnectedSinceMillis)
    }

    @Test
    fun foldClearsTheDisconnectionClockOnAnyRecovery() {
        val disconnected = state(LiveConnectionStatus.Disconnected, base)
        listOf(
            LiveConnectionStatus.Connected,
            LiveConnectionStatus.Reconnecting,
            LiveConnectionStatus.Unknown,
        ).forEach { status ->
            val next = LiveStaleDataBannerProjection.fold(disconnected, status, base + twoMinutes)
            assertEquals(status, next.status)
            assertNull("non-disconnected clears the web ref ($status)", next.disconnectedSinceMillis)
        }
    }

    @Test
    fun foldRestartsTheWindowAfterAFlapBackToDisconnected() {
        val firstOutage = LiveStaleDataBannerProjection.fold(StaleBannerState.initial(), LiveConnectionStatus.Disconnected, base)
        val recovered = LiveStaleDataBannerProjection.fold(firstOutage, LiveConnectionStatus.Connected, base + 1_000L)
        val secondOutage =
            LiveStaleDataBannerProjection.fold(recovered, LiveConnectionStatus.Disconnected, base + 2_000L)
        assertEquals("a fresh outage re-stamps the clock", base + 2_000L, secondOutage.disconnectedSinceMillis)
    }

    // ── render: the web `show` threshold ──────────────────────────────────────────────────────────────────────

    @Test
    fun bannerHiddenWhileConnected() {
        assertFalse(LiveStaleDataBannerProjection.render(state(LiveConnectionStatus.Connected), base).visible)
    }

    @Test
    fun bannerHiddenWhileReconnecting() {
        assertFalse(LiveStaleDataBannerProjection.render(state(LiveConnectionStatus.Reconnecting), base).visible)
    }

    @Test
    fun bannerHiddenDuringColdStartUnknown() {
        assertFalse(LiveStaleDataBannerProjection.render(state(LiveConnectionStatus.Unknown), base).visible)
    }

    @Test
    fun bannerHiddenWhileDisconnectedInsideTheTwoMinuteWindow() {
        val justUnder = state(LiveConnectionStatus.Disconnected, base)
        assertFalse(
            "the wire is down but not yet past two minutes",
            LiveStaleDataBannerProjection.render(justUnder, base + twoMinutes - 1L).visible,
        )
    }

    @Test
    fun bannerShownExactlyAtTheTwoMinuteBoundary() {
        val outage = state(LiveConnectionStatus.Disconnected, base)
        assertTrue(
            "the web threshold is >= 2min",
            LiveStaleDataBannerProjection.render(outage, base + twoMinutes).visible,
        )
    }

    @Test
    fun bannerShownOnceDisconnectedPastTwoMinutes() {
        val outage = state(LiveConnectionStatus.Disconnected, base)
        assertTrue(LiveStaleDataBannerProjection.render(outage, base + twoMinutes + 30_000L).visible)
    }

    @Test
    fun bannerHiddenWhenDisconnectedButNotYetStamped() {
        // Defensive: a disconnected status with no stamp can never be produced by fold, but render must still hide.
        assertFalse(LiveStaleDataBannerProjection.render(state(LiveConnectionStatus.Disconnected), base + twoMinutes).visible)
    }

    // ── remainingMillis: the web setTimeout countdown ─────────────────────────────────────────────────────────

    @Test
    fun remainingCountsDownWithinTheWindow() {
        val outage = state(LiveConnectionStatus.Disconnected, base)
        assertEquals(twoMinutes - 30_000L, LiveStaleDataBannerProjection.remainingMillis(outage, base + 30_000L))
    }

    @Test
    fun remainingIsZeroPastTheWindow() {
        val outage = state(LiveConnectionStatus.Disconnected, base)
        assertEquals(0L, LiveStaleDataBannerProjection.remainingMillis(outage, base + twoMinutes + 5_000L))
    }

    @Test
    fun remainingIsTheFullThresholdWhenNotDisconnected() {
        assertEquals(twoMinutes, LiveStaleDataBannerProjection.remainingMillis(state(LiveConnectionStatus.Connected), base))
    }

    // ── seed + diagnostics contract ───────────────────────────────────────────────────────────────────────────

    @Test
    fun initialStateIsAHiddenColdStart() {
        val seed = StaleBannerState.initial()
        assertEquals(LiveConnectionStatus.Unknown, seed.status)
        assertNull(seed.disconnectedSinceMillis)
        assertFalse(LiveStaleDataBannerProjection.render(seed, base).visible)
    }

    @Test
    fun diagnosticsSlugMatchesTheSurfaceContract() {
        assertEquals("LiveStaleDataBanner", LiveStaleDataBannerRegistration.SLUG)
        assertEquals(LiveStaleDataBannerRegistration.SLUG, LiveStaleDataBannerDiagnostics.SLUG)
    }
}
