// Off-device unit tests for the pure AIFeedbackQueueTriage model: the stream reducer, the surface classifier
// (every loading / empty / content / error / stale / offline branch the web component resolves), the freshness
// rule, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aifeedbackqueuetriage

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIFeedbackQueueTriageModelTest {
    private val window = TRIAGE_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startDraftingEntersStreamingAndClearsTransients() {
        val next =
            AiTriageState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startDrafting()
        assertEquals(TriagePhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiTriageState(phase = TriagePhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(TriagePhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiTriageState(phase = TriagePhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(TriagePhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiTriageState(phase = TriagePhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(TriagePhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiTriageState(phase = TriagePhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(TriagePhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiTriageState(phase = TriagePhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(TriagePhase.Done, promoted.phase)
        val untouched = AiTriageState(phase = TriagePhase.Failed).finishIfStreaming(9L)
        assertEquals(TriagePhase.Failed, untouched.phase)
    }

    // ── canStart parity with web `haveFeedback` (finite number > 0) ──────────────────
    @Test
    fun canStartMirrorsPositiveFeedbackId() {
        assertTrue(AiTriageState(feedbackId = 4096L).canStart)
        assertFalse(AiTriageState(feedbackId = 0L).canStart)
        assertFalse(AiTriageState(feedbackId = -1L).canStart)
        assertFalse(AiTriageState(feedbackId = null).canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyTriage(AiTriageState(gateEnabled = false, feedbackId = 4096L), nowMs = 0L)
        assertEquals(TriageSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            TriageSurface.Resting(canStart = true),
            classifyTriage(AiTriageState(feedbackId = 4096L), nowMs = 0L),
        )
        assertEquals(
            TriageSurface.Resting(canStart = false),
            classifyTriage(AiTriageState(feedbackId = null), nowMs = 0L),
        )
        assertEquals(
            TriageSurface.Resting(canStart = false),
            classifyTriage(AiTriageState(feedbackId = 0L), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyTriage(AiTriageState(feedbackId = 4096L, phase = TriagePhase.Streaming), nowMs = 0L)
        assertEquals(TriageSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyTriage(
                AiTriageState(feedbackId = 4096L, phase = TriagePhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(TriageSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyTriage(
                AiTriageState(
                    feedbackId = 4096L,
                    phase = TriagePhase.Done,
                    committedText = "proposed",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(TriageSurface.Ready("proposed", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyTriage(
                AiTriageState(
                    feedbackId = 4096L,
                    phase = TriagePhase.Done,
                    committedText = "proposed",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(TriageSurface.Ready("proposed", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyTriage(
                AiTriageState(feedbackId = 4096L, phase = TriagePhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(TriageSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyTriage(
                AiTriageState(
                    feedbackId = 4096L,
                    phase = TriagePhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(TriageSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyTriage(
                AiTriageState(
                    feedbackId = 4096L,
                    phase = TriagePhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(TriageSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyTriage(
                AiTriageState(feedbackId = 4096L, phase = TriagePhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(TriageSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyTriage(
                AiTriageState(feedbackId = 4096L, phase = TriagePhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(TriageSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Helix triage advisor", "Helix", "Get a proposed status.")
        assertEquals("Helix triage advisor (Helix). Get a proposed status.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            TriageOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(TriageSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(TriageSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(TriageSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(TriageSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(TriageSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(TriageSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(TriageSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(TriageSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = TriageOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(TriageSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(TriageSurface.Hidden, labels))
    }
}
