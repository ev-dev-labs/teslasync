package io.teslasync.android.sharedsurfaces.liveindicator

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveIndicator pure adapter — the native mirror of every decision the web
 * `LiveIndicator` makes between a `useLiveConnection()` result and the rendered chip
 * (web/src/components/data-display/LiveIndicator.tsx): the four wire states, the `formatRelativeTime` freshness
 * buckets, the pill-only freshness condition, and the reconnecting spin gated by reduced motion. Because the
 * composable is a thin render layer over [LiveIndicatorProjection], the per-branch assertions here double as
 * the surface's state "snapshot". Runs in the :app:testReleaseUnitTest gate.
 */
class LiveIndicatorProjectionTest {
    private val base = 1_700_000_000_000L

    private fun snap(
        status: LiveConnectionStatus,
        lastMessageAtMillis: Long? = base,
        stale: Boolean = false,
    ) = LiveConnectionSnapshot(status, lastMessageAtMillis, stale)

    private fun render(
        snapshot: LiveConnectionSnapshot,
        variant: LiveIndicatorVariant = LiveIndicatorVariant.Pill,
        nowMs: Long = base,
        reduceMotion: Boolean = true,
    ): LiveRender = LiveIndicatorProjection.render(snapshot, variant, nowMs, reduceMotion)

    // ── relativeLabel: web formatRelativeTime buckets ─────────────────────────────────────────────────

    @Test
    fun relativeLabelIsNoneWhenNoMessageHasBeenSeen() {
        assertEquals(RelativeLabel(RelativeUnit.None), LiveIndicatorProjection.relativeLabel(null, base))
    }

    @Test
    fun relativeLabelHoldsJustNowForTheFirstMinute() {
        assertEquals(RelativeLabel(RelativeUnit.JustNow), LiveIndicatorProjection.relativeLabel(base, base + 30_000L))
    }

    @Test
    fun relativeLabelBucketsMinutesAndHours() {
        assertEquals(RelativeLabel(RelativeUnit.Minutes, 5), LiveIndicatorProjection.relativeLabel(base, base + 5 * 60_000L))
        assertEquals(RelativeLabel(RelativeUnit.Hours, 2), LiveIndicatorProjection.relativeLabel(base, base + 2 * 3_600_000L))
    }

    @Test
    fun relativeLabelFallsBackToAnAbsoluteDatePastADay() {
        val label = LiveIndicatorProjection.relativeLabel(base, base + 25 * 3_600_000L)
        assertEquals(RelativeUnit.Absolute, label.unit)
        assertEquals(base, label.atMillis)
    }

    @Test
    fun negativeClockSkewClampsToJustNow() {
        assertEquals(RelativeLabel(RelativeUnit.JustNow), LiveIndicatorProjection.relativeLabel(base, base - 5_000L))
    }

    // ── render: status, freshness condition, spin gating ──────────────────────────────────────────────

    @Test
    fun connectedPillShowsTheFreshnessStampAndNeverSpins() {
        val r = render(snap(LiveConnectionStatus.Connected), nowMs = base + 3 * 60_000L, reduceMotion = false)
        assertEquals(LiveConnectionStatus.Connected, r.status)
        assertTrue("the connected pill shows · {relative-time}", r.showFreshness)
        assertEquals(RelativeLabel(RelativeUnit.Minutes, 3), r.freshness)
        assertFalse(r.spin)
    }

    @Test
    fun freshnessStampIsForThePillVariantOnly() {
        val dot = render(snap(LiveConnectionStatus.Connected), variant = LiveIndicatorVariant.Dot)
        assertFalse("the dot variant has no text", dot.showFreshness)

        val compact = render(snap(LiveConnectionStatus.Connected), variant = LiveIndicatorVariant.Compact)
        assertFalse("the compact variant omits the freshness stamp (web)", compact.showFreshness)
    }

    @Test
    fun freshnessStampRequiresAKnownLastMessageTime() {
        val noTime = render(snap(LiveConnectionStatus.Connected, lastMessageAtMillis = null))
        assertFalse("no stamp without a last-message time (web `lastMessageAt`)", noTime.showFreshness)
    }

    @Test
    fun reconnectingSpinsTheIconUnlessReducedMotion() {
        val animated = render(snap(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null), reduceMotion = false)
        assertTrue("the reconnecting icon spins (web animate-spin)", animated.spin)
        assertFalse(animated.showFreshness)

        val reduced = render(snap(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null))
        assertFalse("reduced motion suppresses the spin", reduced.spin)
    }

    @Test
    fun disconnectedAndUnknownNeitherSpinNorShowFreshness() {
        val disconnected = render(snap(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null), reduceMotion = false)
        assertEquals(LiveConnectionStatus.Disconnected, disconnected.status)
        assertFalse(disconnected.spin)
        assertFalse(disconnected.showFreshness)

        val unknown = render(snap(LiveConnectionStatus.Unknown, lastMessageAtMillis = null), reduceMotion = false)
        assertEquals(LiveConnectionStatus.Unknown, unknown.status)
        assertFalse(unknown.spin)
        assertFalse(unknown.showFreshness)
    }

    @Test
    fun connectedButStaleStaysConnectedWithAnAgedStamp() {
        val r = render(snap(LiveConnectionStatus.Connected, stale = true), nowMs = base + 5 * 60_000L)
        assertEquals("the wire is still up while data ages (web parity)", LiveConnectionStatus.Connected, r.status)
        assertTrue("the staleness flag is carried through", r.stale)
        assertTrue(r.showFreshness)
        assertEquals(RelativeLabel(RelativeUnit.Minutes, 5), r.freshness)
    }

    // ── snapshot seed ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun unknownSnapshotIsTheColdStartSeed() {
        val seed = LiveConnectionSnapshot.unknown()
        assertEquals(LiveConnectionStatus.Unknown, seed.status)
        assertEquals(null, seed.lastMessageAtMillis)
        assertFalse(seed.stale)
    }
}
