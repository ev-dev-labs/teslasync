package io.teslasync.android.sharedsurfaces.livetelemetrysegment

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveTelemetrySegment pure adapter — the native mirror of every decision the
 * web `LiveTelemetrySegment` makes between a `useLiveConnection()` result and the rendered segment
 * (web/src/components/layout/status-bar/LiveTelemetrySegment.tsx): the four wire states, the seconds-first
 * `ageSecondsLabel` buckets, the inline-age condition (`!iconOnly && connected && lastMessageAt`), the
 * `iconOnly` mode, and the reconnecting spin gated by reduced motion. Because the composable is a thin render
 * layer over [LiveTelemetrySegmentProjection], the per-branch assertions here double as the surface's state
 * "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class LiveTelemetrySegmentProjectionTest {
    private val base = 1_700_000_000_000L

    private fun snap(
        status: LiveConnectionStatus,
        lastMessageAtMillis: Long? = base,
        stale: Boolean = false,
    ) = LiveTelemetrySnapshot(status, lastMessageAtMillis, stale)

    private fun render(
        snapshot: LiveTelemetrySnapshot,
        iconOnly: Boolean = false,
        nowMs: Long = base,
        reduceMotion: Boolean = true,
    ): LiveTelemetryRender = LiveTelemetrySegmentProjection.render(snapshot, iconOnly, nowMs, reduceMotion)

    // ── ageLabel: web ageSecondsLabel buckets ─────────────────────────────────────────────────────────

    @Test
    fun ageLabelIsNoneWhenNoMessageHasBeenSeen() {
        assertEquals(AgeLabel(AgeUnit.None), LiveTelemetrySegmentProjection.ageLabel(null, base))
    }

    @Test
    fun ageLabelIsNoneForAFutureSkewedStamp() {
        // web: `if (!Number.isFinite(ms) || ms < 0) return '—'` — a stamp in the future reads "—", not "0s".
        assertEquals(AgeLabel(AgeUnit.None), LiveTelemetrySegmentProjection.ageLabel(base + 5_000L, base))
    }

    @Test
    fun ageLabelShowsWholeSecondsForTheFirstMinute() {
        assertEquals(AgeLabel(AgeUnit.Seconds, 0), LiveTelemetrySegmentProjection.ageLabel(base, base))
        assertEquals(AgeLabel(AgeUnit.Seconds, 12), LiveTelemetrySegmentProjection.ageLabel(base, base + 12_000L))
        assertEquals(AgeLabel(AgeUnit.Seconds, 59), LiveTelemetrySegmentProjection.ageLabel(base, base + 59_000L))
    }

    @Test
    fun ageLabelRollsToMinutesAtSixtySeconds() {
        assertEquals(AgeLabel(AgeUnit.Minutes, 1), LiveTelemetrySegmentProjection.ageLabel(base, base + 60_000L))
        assertEquals(AgeLabel(AgeUnit.Minutes, 3), LiveTelemetrySegmentProjection.ageLabel(base, base + 3 * 60_000L))
        assertEquals(AgeLabel(AgeUnit.Minutes, 59), LiveTelemetrySegmentProjection.ageLabel(base, base + 59 * 60_000L))
    }

    @Test
    fun ageLabelRollsToHoursAtSixtyMinutesAndNeverToDays() {
        assertEquals(AgeLabel(AgeUnit.Hours, 1), LiveTelemetrySegmentProjection.ageLabel(base, base + 60 * 60_000L))
        // web caps at hours: a 25-hour-old wire reads "25h", never "1d".
        assertEquals(AgeLabel(AgeUnit.Hours, 25), LiveTelemetrySegmentProjection.ageLabel(base, base + 25 * 60 * 60_000L))
    }

    @Test
    fun ageLabelFloorsTruncatesLikeWebMathFloor() {
        // 12.9s → 12s (web Math.floor(ms / 1000)).
        assertEquals(AgeLabel(AgeUnit.Seconds, 12), LiveTelemetrySegmentProjection.ageLabel(base, base + 12_900L))
    }

    // ── render: status, inline-age condition, iconOnly, spin gating ───────────────────────────────────

    @Test
    fun connectedSegmentShowsTheInlineAgeStampAndLabelAndNeverSpins() {
        val r = render(snap(LiveConnectionStatus.Connected), nowMs = base + 12_000L, reduceMotion = false)
        assertEquals(LiveConnectionStatus.Connected, r.status)
        assertTrue("the connected segment shows the label", r.showLabel)
        assertTrue("the connected segment shows the inline · {age} stamp", r.showInlineAge)
        assertTrue("connected drives the tooltip's connected branch", r.connected)
        assertEquals(AgeLabel(AgeUnit.Seconds, 12), r.age)
        assertFalse(r.spin)
    }

    @Test
    fun iconOnlyDropsBothTheLabelAndTheInlineAge() {
        val r = render(snap(LiveConnectionStatus.Connected), iconOnly = true, nowMs = base + 12_000L)
        assertFalse("iconOnly hides the label (web !iconOnly)", r.showLabel)
        assertFalse("iconOnly hides the inline age stamp", r.showInlineAge)
        // the age is still computed (for the tooltip) even though the inline stamp is hidden.
        assertEquals(AgeLabel(AgeUnit.Seconds, 12), r.age)
    }

    @Test
    fun inlineAgeRequiresAKnownLastMessageTime() {
        val noTime = render(snap(LiveConnectionStatus.Connected, lastMessageAtMillis = null))
        assertFalse("no inline stamp without a last-message time (web `lastMessageAt`)", noTime.showInlineAge)
        assertEquals(AgeLabel(AgeUnit.None), noTime.age)
    }

    @Test
    fun reconnectingSpinsTheIconUnlessReducedMotion() {
        val animated = render(snap(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null), reduceMotion = false)
        assertTrue("the reconnecting icon spins (web animate-spin)", animated.spin)
        assertFalse(animated.showInlineAge)
        assertFalse("reconnecting is not the connected tooltip branch", animated.connected)

        val reduced = render(snap(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null))
        assertFalse("reduced motion suppresses the spin", reduced.spin)
    }

    @Test
    fun disconnectedAndUnknownNeitherSpinNorShowInlineAge() {
        val disconnected = render(snap(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null), reduceMotion = false)
        assertEquals(LiveConnectionStatus.Disconnected, disconnected.status)
        assertFalse(disconnected.spin)
        assertFalse(disconnected.showInlineAge)
        assertTrue("the label still renders for disconnected", disconnected.showLabel)

        val unknown = render(snap(LiveConnectionStatus.Unknown, lastMessageAtMillis = null), reduceMotion = false)
        assertEquals(LiveConnectionStatus.Unknown, unknown.status)
        assertFalse(unknown.spin)
        assertFalse(unknown.showInlineAge)
    }

    @Test
    fun connectedButStaleStaysConnectedWithAnAgedStamp() {
        val r = render(snap(LiveConnectionStatus.Connected, stale = true), nowMs = base + 3 * 60_000L)
        assertEquals("the wire is still up while data ages (web parity)", LiveConnectionStatus.Connected, r.status)
        assertTrue("the staleness flag is carried through", r.stale)
        assertTrue(r.showInlineAge)
        assertEquals(AgeLabel(AgeUnit.Minutes, 3), r.age)
    }

    // ── snapshot seed ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun unknownSnapshotIsTheColdStartSeed() {
        val seed = LiveTelemetrySnapshot.unknown()
        assertEquals(LiveConnectionStatus.Unknown, seed.status)
        assertEquals(null, seed.lastMessageAtMillis)
        assertFalse(seed.stale)
    }
}
