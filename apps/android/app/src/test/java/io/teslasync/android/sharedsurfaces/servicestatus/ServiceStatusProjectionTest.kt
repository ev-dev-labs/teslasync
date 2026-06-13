package io.teslasync.android.sharedsurfaces.servicestatus

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ServiceStatus pure adapter — the native mirror of every decision the web
 * `ServiceStatusBanner` + `SystemHealthDot` make before rendering (web/src/components/data-display/ServiceStatus.tsx),
 * folded onto the wired live-wire health (ADR-009): the offline-banner visibility, the four `overall` health
 * buckets (+ the cold-start / idle tiers the web hides), the connected-but-stale degrade, and the connected-but-idle
 * empty surface. Because the composable is a thin render layer over [ServiceStatusProjection], the per-branch
 * assertions here double as the surface's state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class ServiceStatusProjectionTest {
    private val stamp = 1_700_000_000_000L

    private fun render(
        status: LiveConnectionStatus,
        lastMessageAtMillis: Long? = stamp,
        stale: Boolean = false,
    ): ServiceStatusRender = ServiceStatusProjection.render(ServiceStatusSnapshot(status, lastMessageAtMillis, stale))

    // ── content: a connected, fresh wire is the healthy green dot ────────────────────────────────────────

    @Test
    fun connectedFreshWireIsHealthyWithNoBannerOrChips() {
        val r = render(LiveConnectionStatus.Connected)
        assertEquals(SystemHealth.Healthy, r.health)
        assertFalse("a healthy wire is not loading", r.loading)
        assertFalse("a healthy wire is not empty", r.empty)
        assertFalse("a healthy wire shows no offline banner", r.showOfflineBanner)
        assertFalse("a healthy wire shows no stale chip", r.showStaleChip)
    }

    // ── error / offline: a down wire shows the banner and the red dot ────────────────────────────────────

    @Test
    fun disconnectedWireIsDownAndShowsOfflineBanner() {
        val r = render(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null)
        assertEquals(SystemHealth.Down, r.health)
        assertTrue("a down wire shows the offline banner", r.showOfflineBanner)
        assertTrue("offline flag is set", r.offline)
        assertFalse("a down wire is not loading", r.loading)
        assertFalse("a down wire shows no stale chip", r.showStaleChip)
    }

    // ── degraded: reconnecting wire is amber ─────────────────────────────────────────────────────────────

    @Test
    fun reconnectingWireIsDegraded() {
        val r = render(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null)
        assertEquals(SystemHealth.Degraded, r.health)
        assertTrue(r.reconnecting)
        assertFalse(r.showOfflineBanner)
        assertFalse(r.loading)
    }

    // ── loading: a cold start that never connected is the loading surface ────────────────────────────────

    @Test
    fun unknownWireIsTheLoadingSurface() {
        val r = render(LiveConnectionStatus.Unknown, lastMessageAtMillis = null)
        assertEquals(SystemHealth.Unknown, r.health)
        assertTrue("a cold start is the loading surface", r.loading)
        assertFalse(r.showOfflineBanner)
        assertFalse(r.empty)
    }

    // ── empty: a connected wire with no telemetry yet is the empty surface ───────────────────────────────

    @Test
    fun connectedButSilentWireIsTheEmptySurface() {
        val r = render(LiveConnectionStatus.Connected, lastMessageAtMillis = null)
        assertTrue("connected-but-idle is the empty surface", r.empty)
        assertEquals(SystemHealth.Unknown, r.health)
        assertFalse("the empty surface is not the loading surface", r.loading)
        assertFalse(r.showOfflineBanner)
    }

    // ── stale: a connected wire past the staleness window is amber with a chip ────────────────────────────

    @Test
    fun connectedButStaleWireIsDegradedWithStaleChip() {
        val r = render(LiveConnectionStatus.Connected, stale = true)
        assertEquals(SystemHealth.Degraded, r.health)
        assertTrue("a stale wire shows the stale chip", r.showStaleChip)
        assertTrue(r.stale)
        assertFalse("a stale wire is still connected, not empty", r.empty)
        assertFalse(r.showOfflineBanner)
    }

    @Test
    fun staleIsIgnoredWhenTheWireIsDown() {
        // Staleness is only meaningful on an open wire; a disconnected wire is Down, never a stale chip.
        val r = render(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null, stale = true)
        assertEquals(SystemHealth.Down, r.health)
        assertFalse("a down wire never shows the stale chip", r.showStaleChip)
        assertTrue(r.showOfflineBanner)
    }

    // ── healthOf: the explicit bucket mapping ────────────────────────────────────────────────────────────

    @Test
    fun healthOfMapsEachTier() {
        assertEquals(
            SystemHealth.Unknown,
            ServiceStatusProjection.healthOf(LiveConnectionStatus.Unknown, stale = false, empty = false),
        )
        assertEquals(
            SystemHealth.Down,
            ServiceStatusProjection.healthOf(LiveConnectionStatus.Disconnected, stale = false, empty = false),
        )
        assertEquals(
            SystemHealth.Degraded,
            ServiceStatusProjection.healthOf(LiveConnectionStatus.Reconnecting, stale = false, empty = false),
        )
        assertEquals(
            SystemHealth.Degraded,
            ServiceStatusProjection.healthOf(LiveConnectionStatus.Connected, stale = true, empty = false),
        )
        assertEquals(
            SystemHealth.Unknown,
            ServiceStatusProjection.healthOf(LiveConnectionStatus.Connected, stale = false, empty = true),
        )
        assertEquals(
            SystemHealth.Healthy,
            ServiceStatusProjection.healthOf(LiveConnectionStatus.Connected, stale = false, empty = false),
        )
    }

    @Test
    fun snapshotUnknownSeedIsTheLoadingSurface() {
        val r = ServiceStatusProjection.render(ServiceStatusSnapshot.unknown())
        assertTrue(r.loading)
        assertEquals(SystemHealth.Unknown, r.health)
    }
}
