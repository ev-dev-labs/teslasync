// Off-device unit tests for the pure AIAnomalyExplanations model: the stream reducer, the surface classifier
// (every loading / empty / content / error / stale / offline branch the web component resolves), the freshness
// rule, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aianomalyexplanations

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIAnomalyExplanationsModelTest {
    private val window = EXPLANATION_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiExplanationState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(ExplanationPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiExplanationState(phase = ExplanationPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(ExplanationPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiExplanationState(phase = ExplanationPhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(ExplanationPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiExplanationState(phase = ExplanationPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(ExplanationPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiExplanationState(phase = ExplanationPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(ExplanationPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiExplanationState(phase = ExplanationPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(ExplanationPhase.Done, promoted.phase)
        val untouched = AiExplanationState(phase = ExplanationPhase.Failed).finishIfStreaming(9L)
        assertEquals(ExplanationPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyExplanation(AiExplanationState(gateEnabled = false, vehicleId = 1L), nowMs = 0L)
        assertEquals(ExplanationSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            ExplanationSurface.Resting(canStart = true),
            classifyExplanation(AiExplanationState(vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            ExplanationSurface.Resting(canStart = false),
            classifyExplanation(AiExplanationState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyExplanation(AiExplanationState(vehicleId = 1L, phase = ExplanationPhase.Streaming), nowMs = 0L)
        assertEquals(ExplanationSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyExplanation(
                AiExplanationState(vehicleId = 1L, phase = ExplanationPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(ExplanationSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyExplanation(
                AiExplanationState(
                    vehicleId = 1L,
                    phase = ExplanationPhase.Done,
                    committedText = "explained",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(ExplanationSurface.Ready("explained", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyExplanation(
                AiExplanationState(
                    vehicleId = 1L,
                    phase = ExplanationPhase.Done,
                    committedText = "explained",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(ExplanationSurface.Ready("explained", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyExplanation(
                AiExplanationState(vehicleId = 1L, phase = ExplanationPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(ExplanationSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyExplanation(
                AiExplanationState(
                    vehicleId = 1L,
                    phase = ExplanationPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(ExplanationSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyExplanation(
                AiExplanationState(
                    vehicleId = 1L,
                    phase = ExplanationPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(ExplanationSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyExplanation(
                AiExplanationState(vehicleId = 1L, phase = ExplanationPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(ExplanationSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyExplanation(
                AiExplanationState(vehicleId = 1L, phase = ExplanationPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(ExplanationSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Helix explanation", "Helix", "Get a plain-language explanation.")
        assertEquals("Helix explanation (Helix). Get a plain-language explanation.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            ExplanationOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(ExplanationSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(ExplanationSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(ExplanationSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(ExplanationSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(ExplanationSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(ExplanationSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(ExplanationSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(ExplanationSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = ExplanationOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(ExplanationSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(ExplanationSurface.Hidden, labels))
    }
}
