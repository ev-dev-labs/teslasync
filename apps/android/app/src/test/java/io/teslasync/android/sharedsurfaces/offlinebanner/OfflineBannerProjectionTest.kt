package io.teslasync.android.sharedsurfaces.offlinebanner

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the OfflineBanner pure adapter — the native mirror of every decision the web
 * `OfflineBanner` makes before rendering (web/src/components/feedback/OfflineBanner.tsx), folded onto the wired
 * live-wire health (ADR-009): the online dormant branch (web `if (online) return null`), the down-wire offline
 * branch (the web's offline `AlertBanner`), and the reconnecting branch the native proxy distinguishes. Because
 * the composable is a thin render layer over [OfflineBannerProjection], the per-branch assertions here double as
 * the surface's state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class OfflineBannerProjectionTest {
    private fun render(status: LiveConnectionStatus): OfflineBannerRender = OfflineBannerProjection.render(OfflineBannerSnapshot(status))

    // ── content / online: a connected wire is dormant (web `if (online) return null`) ─────────────────────

    @Test
    fun connectedWireIsOnlineAndDormant() {
        val r = render(LiveConnectionStatus.Connected)
        assertEquals(OfflineBannerPhase.Online, r.phase)
        assertTrue("a connected wire is online", r.online)
        assertFalse("an online wire shows no banner", r.showBanner)
        assertFalse(r.offline)
        assertFalse(r.reconnecting)
    }

    // ── loading: a cold start that never connected defaults online (web reads navigator.onLine synchronously) ─

    @Test
    fun unknownColdStartIsOnlineAndDormant() {
        val r = render(LiveConnectionStatus.Unknown)
        assertEquals(OfflineBannerPhase.Online, r.phase)
        assertFalse("a cold start defaults online — never a premature offline banner", r.showBanner)
    }

    // ── error / offline: a down wire shows the banner (the web offline branch) ─────────────────────────────

    @Test
    fun disconnectedWireIsOfflineAndShowsBanner() {
        val r = render(LiveConnectionStatus.Disconnected)
        assertEquals(OfflineBannerPhase.Offline, r.phase)
        assertTrue("a down wire shows the offline banner", r.showBanner)
        assertTrue("offline flag is set", r.offline)
        assertFalse("offline is not the reconnecting nuance", r.reconnecting)
        assertFalse(r.online)
    }

    // ── reconnecting: an impaired-but-recovering wire shows the banner with the reconnecting nuance ─────────

    @Test
    fun reconnectingWireShowsBannerWithReconnectingNuance() {
        val r = render(LiveConnectionStatus.Reconnecting)
        assertEquals(OfflineBannerPhase.Reconnecting, r.phase)
        assertTrue("a reconnecting wire still shows the cached-data banner", r.showBanner)
        assertTrue("reconnecting flag is set", r.reconnecting)
        assertFalse("reconnecting does not overclaim a hard offline", r.offline)
        assertFalse(r.online)
    }

    // ── phaseOf: the explicit bucket mapping ───────────────────────────────────────────────────────────────

    @Test
    fun phaseOfMapsEachTier() {
        assertEquals(OfflineBannerPhase.Offline, OfflineBannerProjection.phaseOf(LiveConnectionStatus.Disconnected))
        assertEquals(OfflineBannerPhase.Reconnecting, OfflineBannerProjection.phaseOf(LiveConnectionStatus.Reconnecting))
        assertEquals(OfflineBannerPhase.Online, OfflineBannerProjection.phaseOf(LiveConnectionStatus.Connected))
        assertEquals(OfflineBannerPhase.Online, OfflineBannerProjection.phaseOf(LiveConnectionStatus.Unknown))
    }

    @Test
    fun unknownSeedIsTheDormantOnlineSurface() {
        val r = OfflineBannerProjection.render(OfflineBannerSnapshot.unknown())
        assertEquals(OfflineBannerPhase.Online, r.phase)
        assertFalse(r.showBanner)
    }
}
