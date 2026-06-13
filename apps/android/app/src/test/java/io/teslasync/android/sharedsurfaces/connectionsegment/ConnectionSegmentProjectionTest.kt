// Off-device verification of the ConnectionSegment pure adapter — the native mirror of every decision the web
// `ConnectionSegment` makes before rendering (web/src/components/layout/status-bar/ConnectionSegment.tsx): the
// four health tiers, the per-tier suffix, the freshness fold, and the tooltip / aria label composition. Because
// the composable is a thin render layer over [ConnectionSegmentProjection], the per-branch assertions here
// double as the surface's per-state "snapshot" and as the a11y-label-presence checks. Also covers the
// [ApiHealthState] → [ConnectionSnapshot] adapter (the ISO `lastCheckedAt` parse). Runs in the
// :app:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.connectionsegment

import io.teslasync.shared.core.presentation.apihealth.ApiHealthState
import io.teslasync.shared.core.presentation.apihealth.ApiHealthStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionSegmentProjectionTest {
    private val strings =
        ConnectionSegmentStrings(
            short = "API",
            online = "Online",
            degraded = "Degraded",
            offline = "Offline",
            connecting = "Connecting\u2026",
            tooltip = "API connection",
            aria = "API connection status",
            stale = "Stale",
        )

    // 2023-11-14T22:13:20Z == 1_700_000_000_000 ms (a round, well-known epoch used as the probe stamp here).
    private val checkedAt = 1_700_000_000_000L
    private val now = checkedAt + 1_000L

    private fun render(
        status: ApiHealthStatus,
        latencyMs: Long? = null,
        stale: Boolean = false,
        variant: ConnectionSegmentVariant = ConnectionSegmentVariant.Full,
    ): ConnectionRender = ConnectionRender(status = status, variant = variant, latencyMs = latencyMs, stale = stale)

    // ── content: a fresh ok tier shows the latency suffix and no offline / stale suffix ──────────────────

    @Test
    fun okTierShowsLatencySuffixOnly() {
        val r = render(ApiHealthStatus.OK, latencyMs = 142L)
        assertTrue(r.showLatencySuffix)
        assertFalse(r.showOfflineSuffix)
        assertFalse(r.showStaleSuffix)
        assertFalse("ok is not the unknown loading surface", r.isUnknown)
        assertEquals("Online", ConnectionSegmentProjection.stateLabel(r.status, strings))
    }

    @Test
    fun degradedTierShowsLatencySuffixAndDegradedLabel() {
        val r = render(ApiHealthStatus.DEGRADED, latencyMs = 740L)
        assertTrue(r.showLatencySuffix)
        assertFalse(r.showOfflineSuffix)
        assertEquals("Degraded", ConnectionSegmentProjection.stateLabel(r.status, strings))
    }

    // ── error / offline: a failed probe is the offline surface, hiding its latency (web parity) ──────────

    @Test
    fun offlineTierShowsOfflineSuffixAndHidesLatency() {
        val r = render(ApiHealthStatus.OFFLINE, latencyMs = 5_000L)
        assertTrue(r.isOffline)
        assertTrue(r.showOfflineSuffix)
        assertFalse("offline hides its failed-probe latency", r.showLatencySuffix)
        assertFalse("offline never shows latency in tooltip/aria", r.hasMeasuredLatency)
        assertEquals("Offline", ConnectionSegmentProjection.stateLabel(r.status, strings))
    }

    // ── loading / empty: the cold-start unknown tier renders a non-blank connecting surface ──────────────

    @Test
    fun unknownTierIsTheLoadingSurfaceWithNoSuffix() {
        val r = render(ApiHealthStatus.UNKNOWN)
        assertTrue(r.isUnknown)
        assertFalse(r.showLatencySuffix)
        assertFalse(r.showOfflineSuffix)
        assertFalse(r.showStaleSuffix)
        assertEquals("Connecting\u2026", ConnectionSegmentProjection.stateLabel(r.status, strings))
    }

    // ── stale: an aged up tier shows the stale suffix instead of a now-misleading latency ────────────────

    @Test
    fun staleUpTierShowsStaleSuffixInsteadOfLatency() {
        val r = render(ApiHealthStatus.OK, latencyMs = 142L, stale = true)
        assertTrue(r.showStaleSuffix)
        assertFalse("a stale reading no longer presents its latency as live", r.showLatencySuffix)
    }

    // ── latencyLabel ─────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun latencyLabelFormatsMillisAndEmDash() {
        assertEquals("142ms", ConnectionSegmentProjection.latencyLabel(142L))
        assertEquals("\u2014", ConnectionSegmentProjection.latencyLabel(null))
    }

    // ── tooltip: the verbatim web composition `${tooltip} · ${state}[ · ${lat}][ · ${stale}]` ────────────

    @Test
    fun tooltipMatchesTheWebComposition() {
        assertEquals(
            "API connection \u00b7 Online \u00b7 142ms",
            ConnectionSegmentProjection.tooltipText(render(ApiHealthStatus.OK, latencyMs = 142L), strings),
        )
        assertEquals(
            "API connection \u00b7 Offline",
            ConnectionSegmentProjection.tooltipText(render(ApiHealthStatus.OFFLINE, latencyMs = 5_000L), strings),
        )
        assertEquals(
            "API connection \u00b7 Connecting\u2026",
            ConnectionSegmentProjection.tooltipText(render(ApiHealthStatus.UNKNOWN), strings),
        )
        assertEquals(
            "API connection \u00b7 Online \u00b7 142ms \u00b7 Stale",
            ConnectionSegmentProjection.tooltipText(render(ApiHealthStatus.OK, latencyMs = 142L, stale = true), strings),
        )
    }

    // ── aria: the verbatim web `aria-label` composition + a11y label presence in every state ─────────────

    @Test
    fun ariaMatchesTheWebComposition() {
        assertEquals(
            "API connection status: Online (142ms)",
            ConnectionSegmentProjection.spokenLabel(render(ApiHealthStatus.OK, latencyMs = 142L), strings),
        )
        assertEquals(
            "API connection status: Offline",
            ConnectionSegmentProjection.spokenLabel(render(ApiHealthStatus.OFFLINE, latencyMs = 5_000L), strings),
        )
        assertEquals(
            "API connection status: Online (142ms), Stale",
            ConnectionSegmentProjection.spokenLabel(render(ApiHealthStatus.OK, latencyMs = 142L, stale = true), strings),
        )
    }

    @Test
    fun everyTierHasANonBlankSpokenLabel() {
        ApiHealthStatus.entries.forEach { status ->
            val label = ConnectionSegmentProjection.spokenLabel(render(status, latencyMs = 10L), strings)
            assertTrue("a11y label present for $status", label.isNotBlank())
            assertTrue("a11y label is prefixed with the aria lead-in for $status", label.startsWith("API connection status:"))
        }
    }

    // ── isStale: derived from probe age, only on an up tier with a known stamp ────────────────────────────

    @Test
    fun isStaleTrueWhenUpTierProbeIsOlderThanWindow() {
        val snap = ConnectionSnapshot(ApiHealthStatus.OK, latencyMs = 142L, lastCheckedAtMillis = checkedAt)
        assertTrue(ConnectionSegmentProjection.isStale(snap, nowMs = checkedAt + 60_000L, staleWindowMs = 45_000L))
        assertFalse(ConnectionSegmentProjection.isStale(snap, nowMs = checkedAt + 10_000L, staleWindowMs = 45_000L))
    }

    @Test
    fun isStaleFalseWithNoStampOrOnOfflineOrUnknownTier() {
        val noStamp = ConnectionSnapshot(ApiHealthStatus.OK, latencyMs = 142L, lastCheckedAtMillis = null)
        assertFalse(ConnectionSegmentProjection.isStale(noStamp, nowMs = now))
        val offline = ConnectionSnapshot(ApiHealthStatus.OFFLINE, latencyMs = 5_000L, lastCheckedAtMillis = checkedAt - 600_000L)
        assertFalse(
            "a failed probe is its own surface, never additionally stale",
            ConnectionSegmentProjection.isStale(offline, nowMs = now),
        )
        val unknown = ConnectionSnapshot.unknown()
        assertFalse(ConnectionSegmentProjection.isStale(unknown, nowMs = now))
    }

    @Test
    fun renderFoldsStaleFromTheSnapshot() {
        val snap = ConnectionSnapshot(ApiHealthStatus.OK, latencyMs = 142L, lastCheckedAtMillis = checkedAt)
        val fresh = ConnectionSegmentProjection.render(snap, ConnectionSegmentVariant.Full, nowMs = checkedAt + 1_000L)
        assertFalse(fresh.stale)
        val aged = ConnectionSegmentProjection.render(snap, ConnectionSegmentVariant.Full, nowMs = checkedAt + 90_000L)
        assertTrue(aged.stale)
    }

    // ── adapter: ApiHealthState → ConnectionSnapshot (the ISO lastCheckedAt parse) ────────────────────────

    @Test
    fun toConnectionSnapshotPassesTierAndLatencyAndParsesStamp() {
        val snap = ApiHealthState(ApiHealthStatus.OK, latencyMs = 142L, lastCheckedAt = "2023-11-14T22:13:20Z").toConnectionSnapshot()
        assertEquals(ApiHealthStatus.OK, snap.status)
        assertEquals(142L, snap.latencyMs)
        assertEquals(checkedAt, snap.lastCheckedAtMillis)
    }

    @Test
    fun toConnectionSnapshotResolvesNullOrBadStampToNoFreshness() {
        val nullStamp = ApiHealthState(ApiHealthStatus.UNKNOWN, latencyMs = null, lastCheckedAt = null).toConnectionSnapshot()
        assertNull(nullStamp.lastCheckedAtMillis)
        val badStamp = ApiHealthState(ApiHealthStatus.OK, latencyMs = 10L, lastCheckedAt = "not-a-timestamp").toConnectionSnapshot()
        assertNull(badStamp.lastCheckedAtMillis)
    }
}
