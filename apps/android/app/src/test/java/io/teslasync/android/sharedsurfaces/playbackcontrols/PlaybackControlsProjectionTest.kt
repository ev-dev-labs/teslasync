package io.teslasync.android.sharedsurfaces.playbackcontrols

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage of the pure [PlaybackControlsProjection] + [ReplayTimeline] — the native port of
 * the web `useTripReplay` clock math (web/src/hooks/useTripReplay.ts), the `PlaybackSpeedMenu` speed
 * helpers, and the `PlaybackControls` keyboard switch (web/src/components/data-display/PlaybackControls.tsx).
 * Every branch the web source exercises is covered here, with no Android, UI, or coroutines in the loop.
 */
class PlaybackControlsProjectionTest {
    private val projection = PlaybackControlsProjection

    private val sec0 = "2024-01-01T00:00:00Z"
    private val sec10 = "2024-01-01T00:00:10Z"
    private val sec20 = "2024-01-01T00:00:20Z"
    private val min1 = "2024-01-01T00:01:00Z"

    private fun positions(vararg timestamps: String?): JsonArray =
        buildJsonArray {
            timestamps.forEach { ts ->
                add(buildJsonObject { if (ts != null) put("timestamp", JsonPrimitive(ts)) })
            }
        }

    // ── ReplayTimeline.fromPositions (web buildTimeline) ─────────────────────────

    @Test
    fun bareArrayBuildsOffsetsFromTimestamps() {
        val timeline = ReplayTimeline.fromPositions(positions(sec0, sec10, min1))
        assertEquals(listOf(0L, 10_000L, 60_000L), timeline.offsetsMs)
        assertEquals(60_000L, timeline.totalMs)
        assertEquals(3, timeline.frameCount)
        assertTrue(!timeline.isEmpty)
    }

    @Test
    fun positionsEnvelopeIsAccepted() {
        val envelope = buildJsonObject { put("positions", positions(sec0, sec10)) }
        assertEquals(listOf(0L, 10_000L), ReplayTimeline.fromPositions(envelope).offsetsMs)
    }

    @Test
    fun emptyOrUnparseableYieldsEmptyTimeline() {
        assertTrue(ReplayTimeline.fromPositions(positions()).isEmpty)
        assertTrue(ReplayTimeline.fromPositions(positions("nonsense", null)).isEmpty)
        assertTrue(ReplayTimeline.fromPositions(JsonNull).isEmpty)
        assertTrue(ReplayTimeline.fromPositions(null).isEmpty)
    }

    @Test
    fun unparseableTimestampMapsToZeroWithoutPoisoningTotal() {
        // First parseable timestamp becomes the origin; the leading bad row maps to 0 (web Number.isFinite).
        val timeline = ReplayTimeline.fromPositions(positions("bad", sec10, sec20))
        assertEquals(listOf(0L, 0L, 10_000L), timeline.offsetsMs)
        assertEquals(10_000L, timeline.totalMs)
    }

    @Test
    fun singlePointTrackIsEmptyBecauseItIsNotPlayable() {
        val timeline = ReplayTimeline.fromPositions(positions(sec0))
        assertEquals(0L, timeline.totalMs)
        assertTrue(timeline.isEmpty)
    }

    @Test
    fun defaultMarkersAreStartAndStopForAPlayableTrack() {
        val markers = ReplayTimeline.fromPositions(positions(sec0, min1)).defaultMarkers()
        assertEquals(2, markers.size)
        assertEquals(ReplayMarkerKind.Start, markers[0].kind)
        assertEquals(0.0, markers[0].at, EPSILON)
        assertEquals(ReplayMarkerKind.Stop, markers[1].kind)
        assertEquals(1.0, markers[1].at, EPSILON)
        assertTrue(ReplayTimeline.EMPTY.defaultMarkers().isEmpty())
    }

    // ── Clock math (web useTripReplay) ───────────────────────────────────────────

    @Test
    fun indexAtTimePicksTheClosestOffset() {
        val offsets = listOf(0L, 10_000L, 60_000L)
        assertEquals(0, projection.indexAtTime(offsets, 4_000L))
        assertEquals(1, projection.indexAtTime(offsets, 9_000L))
        assertEquals(2, projection.indexAtTime(offsets, 55_000L))
        assertEquals(0, projection.indexAtTime(emptyList(), 5L))
    }

    @Test
    fun progressIsClampedToUnitRange() {
        assertEquals(0.5, projection.progressOf(50L, 100L), EPSILON)
        assertEquals(0.0, projection.progressOf(0L, 0L), EPSILON)
        assertEquals(1.0, projection.progressOf(200L, 100L), EPSILON)
        assertEquals(0.0, projection.progressOf(-10L, 100L), EPSILON)
    }

    @Test
    fun advanceTicksAndStopsAtTheEnd() {
        assertEquals(PlaybackControlsProjection.ClockTick(50L, false), projection.advance(0L, 1, 1_000L))
        assertEquals(PlaybackControlsProjection.ClockTick(500L, false), projection.advance(0L, 10, 1_000L))
        assertEquals(PlaybackControlsProjection.ClockTick(1_000L, true), projection.advance(980L, 1, 1_000L))
        assertEquals(PlaybackControlsProjection.ClockTick(0L, true), projection.advance(0L, 1, 0L))
    }

    @Test
    fun seekHelpersClampToTheTrack() {
        assertEquals(500L, projection.seekToProgress(0.5, 1_000L))
        assertEquals(1_000L, projection.seekToProgress(1.5, 1_000L))
        assertEquals(0L, projection.seekToProgress(-1.0, 1_000L))
        assertEquals(5_500L, projection.seekBySeconds(500L, 5, 10_000L))
        assertEquals(0L, projection.seekBySeconds(500L, -100, 10_000L))
        assertEquals(10_000L, projection.seekBySeconds(9_000L, 5, 10_000L))
    }

    @Test
    fun frameSteppingClampsAndMapsToOffsets() {
        assertEquals(1, projection.stepFrame(0, 1, 3))
        assertEquals(2, projection.stepFrame(2, 1, 3))
        assertEquals(0, projection.stepFrame(0, -1, 3))
        assertEquals(0, projection.stepFrame(0, 1, 0))
        assertEquals(10L, projection.offsetForIndex(listOf(0L, 10L, 20L), 1))
        assertEquals(20L, projection.offsetForIndex(listOf(0L, 10L, 20L), 9))
        assertEquals(0L, projection.offsetForIndex(emptyList(), 0))
    }

    @Test
    fun formatClockRendersMinutesAndSeconds() {
        assertEquals("0:00", projection.formatClock(0L))
        assertEquals("0:01", projection.formatClock(1_000L))
        assertEquals("0:06", projection.formatClock(5_500L))
        assertEquals("1:05", projection.formatClock(65_000L))
        assertEquals("10:00", projection.formatClock(600_000L))
    }

    // ── Speed helpers (web PlaybackSpeedMenu) ────────────────────────────────────

    @Test
    fun speedShiftClampsAndCyclesWraps() {
        assertEquals(10, projection.shiftSpeed(1, 1))
        assertEquals(1, projection.shiftSpeed(1, -1))
        assertEquals(100, projection.shiftSpeed(25, 2))
        assertEquals(100, projection.shiftSpeed(100, 1))
        assertEquals(10, projection.shiftSpeed(7, 1)) // unknown speed → slot 0
        assertEquals(10, projection.nextSpeed(1))
        assertEquals(1, projection.nextSpeed(100))
    }

    // ── Keyboard switch (web keydown handler) ────────────────────────────────────

    @Test
    fun spaceAndKToggleAndLabelTheToastFromPlayState() {
        val paused = projection.actionForKey(ShortcutKey.Space, shift = false, wasPlaying = false)
        assertEquals(ShortcutIntent.TogglePlay, paused?.intent)
        assertEquals(ShortcutToast.Play, paused?.toast)
        val playing = projection.actionForKey(ShortcutKey.K, shift = false, wasPlaying = true)
        assertEquals(ShortcutIntent.TogglePlay, playing?.intent)
        assertEquals(ShortcutToast.Pause, playing?.toast)
    }

    @Test
    fun arrowsSkipFiveOrThirtyWithShift() {
        assertEquals(ShortcutIntent.SeekBy(-5), projection.actionForKey(ShortcutKey.ArrowLeft, false, false)?.intent)
        assertEquals(ShortcutIntent.SeekBy(-30), projection.actionForKey(ShortcutKey.ArrowLeft, true, false)?.intent)
        assertEquals(ShortcutIntent.SeekBy(5), projection.actionForKey(ShortcutKey.ArrowRight, false, false)?.intent)
        assertEquals(ShortcutToast.Skip(30), projection.actionForKey(ShortcutKey.ArrowRight, true, false)?.toast)
    }

    @Test
    fun jklStepTenSecondsAndFrames() {
        assertEquals(ShortcutIntent.SeekBy(-10), projection.actionForKey(ShortcutKey.J, false, false)?.intent)
        assertEquals(ShortcutIntent.SeekBy(10), projection.actionForKey(ShortcutKey.L, false, false)?.intent)
        assertEquals(ShortcutIntent.StepFrame(-1), projection.actionForKey(ShortcutKey.Comma, false, false)?.intent)
        assertEquals(ShortcutToast.NextFrame, projection.actionForKey(ShortcutKey.Period, false, false)?.toast)
    }

    @Test
    fun homeEndJumpToEndpoints() {
        val home = projection.actionForKey(ShortcutKey.Home, false, false)
        assertEquals(0.0, (home?.intent as ShortcutIntent.SeekToProgress).progress, EPSILON)
        assertEquals(ShortcutToast.Start, home.toast)
        val end = projection.actionForKey(ShortcutKey.End, false, false)
        assertEquals(1.0, (end?.intent as ShortcutIntent.SeekToProgress).progress, EPSILON)
        assertEquals(ShortcutToast.End, end.toast)
    }

    @Test
    fun digitsJumpToPercentAndOutOfRangeIsIgnored() {
        val five = projection.actionForKey(ShortcutKey.Digit(5), false, false)
        assertEquals(0.5, (five?.intent as ShortcutIntent.SeekToProgress).progress, EPSILON)
        assertEquals(ShortcutToast.Percent(50), five.toast)
        val zero = projection.actionForKey(ShortcutKey.Digit(0), false, false)
        assertEquals(ShortcutToast.Percent(0), zero?.toast)
        assertNull(projection.actionForKey(ShortcutKey.Digit(12), false, false))
    }

    @Test
    fun plusMinusChangeSpeed() {
        assertEquals(ShortcutIntent.SpeedUp, projection.actionForKey(ShortcutKey.Plus, false, false)?.intent)
        assertEquals(ShortcutToast.Faster, projection.actionForKey(ShortcutKey.Plus, false, false)?.toast)
        assertEquals(ShortcutIntent.SpeedDown, projection.actionForKey(ShortcutKey.Minus, false, false)?.intent)
        assertEquals(ShortcutToast.Slower, projection.actionForKey(ShortcutKey.Minus, false, false)?.toast)
    }

    // ── Phase + error classification ─────────────────────────────────────────────

    @Test
    fun phaseMappingMirrorsTheDataLayer() {
        assertEquals(PlaybackPhase.Loading, projection.playbackPhase(UiPhase.Loading))
        assertEquals(PlaybackPhase.Content, projection.playbackPhase(UiPhase.Content))
        assertEquals(PlaybackPhase.Empty, projection.playbackPhase(UiPhase.Empty))
        assertEquals(PlaybackPhase.Error, projection.playbackPhase(UiPhase.Error))
    }

    @Test
    fun queryErrorClassificationCoversEveryBucket() {
        assertEquals(QueryErrorKind.NotFound, projection.queryErrorKindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.Unauthorized, projection.queryErrorKindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.ServerError, projection.queryErrorKindFor(ErrorKind.Http, 503))
        assertEquals(QueryErrorKind.Offline, projection.queryErrorKindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, projection.queryErrorKindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, projection.queryErrorKindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, projection.queryErrorKindFor(ErrorKind.Unknown, null))
    }

    private companion object {
        const val EPSILON = 1e-9
    }
}
