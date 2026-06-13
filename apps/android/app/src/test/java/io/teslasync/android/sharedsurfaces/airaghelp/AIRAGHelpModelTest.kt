// Off-device unit tests for the pure AIRAGHelp model: the stream reducer, the surface classifier (every
// loading / empty / content / error / stale / offline branch the web component resolves), the freshness rule,
// and the accessibility-label builders (TalkBack-label presence for the header, the prompt field, and the
// output). Run by the offline :app:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.airaghelp

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIRAGHelpModelTest {
    private val window = RAG_HELP_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startAskingEntersStreamingAndClearsTransients() {
        val next =
            AiRagHelpState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startAsking()
        assertEquals(HelpAnswerPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiRagHelpState(phase = HelpAnswerPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Open "), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("Settings"), nowMs = 2L)
        assertEquals("Open Settings", next.streamingText)
        assertEquals(HelpAnswerPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiRagHelpState(phase = HelpAnswerPhase.Streaming, streamingText = "the answer")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(HelpAnswerPhase.Done, next.phase)
        assertEquals("the answer", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiRagHelpState(phase = HelpAnswerPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(HelpAnswerPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiRagHelpState(phase = HelpAnswerPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(HelpAnswerPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiRagHelpState(phase = HelpAnswerPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(HelpAnswerPhase.Done, promoted.phase)
        val untouched = AiRagHelpState(phase = HelpAnswerPhase.Failed).finishIfStreaming(9L)
        assertEquals(HelpAnswerPhase.Failed, untouched.phase)
    }

    // ── canStart (prompt-driven) ────────────────────────────────────────────────────
    @Test
    fun canStartTracksNonBlankPrompt() {
        assertFalse(AiRagHelpState(prompt = "").canStart)
        assertFalse(AiRagHelpState(prompt = "   ").canStart)
        assertTrue(AiRagHelpState(prompt = "How do I enable forecasting?").canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyHelpAnswer(AiRagHelpState(gateEnabled = false, prompt = "q"), nowMs = 0L)
        assertEquals(HelpAnswerSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            HelpAnswerSurface.Resting(canStart = true),
            classifyHelpAnswer(AiRagHelpState(prompt = "ask me"), nowMs = 0L),
        )
        assertEquals(
            HelpAnswerSurface.Resting(canStart = false),
            classifyHelpAnswer(AiRagHelpState(prompt = ""), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyHelpAnswer(AiRagHelpState(prompt = "q", phase = HelpAnswerPhase.Streaming), nowMs = 0L)
        assertEquals(HelpAnswerSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(prompt = "q", phase = HelpAnswerPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(HelpAnswerSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(
                    prompt = "q",
                    phase = HelpAnswerPhase.Done,
                    committedText = "answered",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(HelpAnswerSurface.Ready("answered", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(
                    prompt = "q",
                    phase = HelpAnswerPhase.Done,
                    committedText = "answered",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(HelpAnswerSurface.Ready("answered", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(prompt = "q", phase = HelpAnswerPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(HelpAnswerSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(
                    prompt = "q",
                    phase = HelpAnswerPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(HelpAnswerSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(
                    prompt = "q",
                    phase = HelpAnswerPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(HelpAnswerSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(prompt = "q", phase = HelpAnswerPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(HelpAnswerSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyHelpAnswer(
                AiRagHelpState(prompt = "q", phase = HelpAnswerPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(HelpAnswerSurface.Failed(offline = false), surface)
    }

    // ── freshness ───────────────────────────────────────────────────────────────────
    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── identity contract ─────────────────────────────────────────────────────────
    @Test
    fun slugAndFeatureIdMatchWebContract() {
        assertEquals("AIRAGHelp", AI_RAG_HELP_SLUG)
        assertEquals("rag-help", RAG_HELP_FEATURE_ID)
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────
    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        val label = headerAccessibilityLabel("Ask the help assistant", "Helix", "Ask a natural-language question.")
        assertEquals("Ask the help assistant (Helix). Ask a natural-language question.", label)
    }

    @Test
    fun promptLabelMergesFieldLabelAndHint() {
        val label = promptAccessibilityLabel("Your question", "e.g. How do I enable energy cost forecasting?")
        assertEquals("Your question. e.g. How do I enable energy cost forecasting?", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            HelpOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Helix couldn’t answer your question. Please try again.",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(HelpAnswerSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(HelpAnswerSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(HelpAnswerSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(HelpAnswerSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(HelpAnswerSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(HelpAnswerSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Helix couldn’t answer your question. Please try again. cached",
            outputAccessibilityLabel(HelpAnswerSurface.Cached("cached", offline = false), labels),
        )
        assertEquals(
            "Helix couldn’t answer your question. Please try again.",
            outputAccessibilityLabel(HelpAnswerSurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = HelpOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(HelpAnswerSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(HelpAnswerSurface.Hidden, labels))
    }
}
