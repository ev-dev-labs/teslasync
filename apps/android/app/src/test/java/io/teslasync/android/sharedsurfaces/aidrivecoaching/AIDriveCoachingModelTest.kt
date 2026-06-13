// Off-device unit tests for the pure AIDriveCoaching model: the stream reducer, the surface classifier (every
// loading / empty / content / error / stale / offline branch the web component resolves), the freshness rule,
// and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aidrivecoaching

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIDriveCoachingModelTest {
    private val window = COACHING_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiCoachingState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(CoachingPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiCoachingState(phase = CoachingPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(CoachingPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiCoachingState(phase = CoachingPhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(CoachingPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiCoachingState(phase = CoachingPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(CoachingPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiCoachingState(phase = CoachingPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(CoachingPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiCoachingState(phase = CoachingPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(CoachingPhase.Done, promoted.phase)
        val untouched = AiCoachingState(phase = CoachingPhase.Failed).finishIfStreaming(9L)
        assertEquals(CoachingPhase.Failed, untouched.phase)
    }

    // ── canStart parity with web !!driveId ──────────────────────────────────────────
    @Test
    fun canStartMirrorsTruthyDriveId() {
        assertTrue(AiCoachingState(driveId = "drive-1").canStart)
        assertFalse(AiCoachingState(driveId = null).canStart)
        assertFalse(AiCoachingState(driveId = "").canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyCoaching(AiCoachingState(gateEnabled = false, driveId = "drive-1"), nowMs = 0L)
        assertEquals(CoachingSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            CoachingSurface.Resting(canStart = true),
            classifyCoaching(AiCoachingState(driveId = "drive-1"), nowMs = 0L),
        )
        assertEquals(
            CoachingSurface.Resting(canStart = false),
            classifyCoaching(AiCoachingState(driveId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyCoaching(AiCoachingState(driveId = "drive-1", phase = CoachingPhase.Streaming), nowMs = 0L)
        assertEquals(CoachingSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyCoaching(
                AiCoachingState(driveId = "drive-1", phase = CoachingPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(CoachingSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyCoaching(
                AiCoachingState(
                    driveId = "drive-1",
                    phase = CoachingPhase.Done,
                    committedText = "coached",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(CoachingSurface.Ready("coached", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyCoaching(
                AiCoachingState(
                    driveId = "drive-1",
                    phase = CoachingPhase.Done,
                    committedText = "coached",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(CoachingSurface.Ready("coached", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyCoaching(
                AiCoachingState(driveId = "drive-1", phase = CoachingPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(CoachingSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyCoaching(
                AiCoachingState(
                    driveId = "drive-1",
                    phase = CoachingPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(CoachingSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyCoaching(
                AiCoachingState(
                    driveId = "drive-1",
                    phase = CoachingPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(CoachingSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyCoaching(
                AiCoachingState(driveId = "drive-1", phase = CoachingPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(CoachingSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyCoaching(
                AiCoachingState(driveId = "drive-1", phase = CoachingPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(CoachingSurface.Failed(offline = false), surface)
    }

    // ── freshness ───────────────────────────────────────────────────────────────────
    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────
    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        val label = headerAccessibilityLabel("Drive coaching", "Helix", "Get a plain-language coaching summary.")
        assertEquals("Drive coaching (Helix). Get a plain-language coaching summary.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            CoachingOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(CoachingSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(CoachingSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(CoachingSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(CoachingSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(CoachingSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(CoachingSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(CoachingSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(CoachingSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = CoachingOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(CoachingSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(CoachingSurface.Hidden, labels))
    }
}
