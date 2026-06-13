// Off-device unit tests for the pure AILifetimeStatsQA model: the question-length cap, the canStart inputs
// (vehicle + valid question), the stream reducer, the surface classifier (every loading / empty / content /
// error / stale / offline branch the web component resolves), the freshness rule, and the accessibility-label
// builders (TalkBack-label presence). Run by the offline :android:testReleaseUnitTest gate — no Compose, no
// Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailifetimestatsqa

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AILifetimeStatsQAModelTest {
    private val window = QA_FRESHNESS_WINDOW_MS

    // ── question cap ────────────────────────────────────────────────────────────────
    @Test
    fun capQuestionTruncatesBeyondMaxAndKeepsShorter() {
        assertEquals("hi", capQuestion("hi"))
        assertEquals(MAX_QUESTION_CHARS, capQuestion("a".repeat(MAX_QUESTION_CHARS + 50)).length)
        assertEquals(MAX_QUESTION_CHARS, capQuestion("a".repeat(MAX_QUESTION_CHARS)).length)
    }

    // ── canStart inputs ─────────────────────────────────────────────────────────────
    @Test
    fun canStartRequiresVehicleAndValidQuestion() {
        assertTrue(AiQaState(vehicleId = 1L, question = "how far?").canStart)
        assertFalse(AiQaState(vehicleId = null, question = "how far?").canStart)
        assertFalse(AiQaState(vehicleId = 1L, question = "").canStart)
        assertFalse(AiQaState(vehicleId = 1L, question = "   ").canStart)
    }

    @Test
    fun haveQuestionRejectsOverCapEvenIfTrimmed() {
        val overCap = AiQaState(vehicleId = 1L, question = "a".repeat(MAX_QUESTION_CHARS + 1))
        assertFalse(overCap.haveQuestion)
        assertFalse(overCap.canStart)
    }

    @Test
    fun trimmedQuestionStripsSurroundingWhitespace() {
        assertEquals("how far?", AiQaState(question = "  how far?  ").trimmedQuestion)
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startAskingEntersStreamingAndClearsTransients() {
        val next =
            AiQaState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startAsking()
        assertEquals(QaPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiQaState(phase = QaPhase.Streaming)
                .onChunk(AiQaChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiQaChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(QaPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiQaState(phase = QaPhase.Streaming, streamingText = "answer text")
                .onChunk(AiQaChunk.Done, nowMs = 42L)
        assertEquals(QaPhase.Done, next.phase)
        assertEquals("answer text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiQaState(phase = QaPhase.Streaming, streamingText = "   ")
                .onChunk(AiQaChunk.Done, nowMs = 7L)
        assertEquals(QaPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiQaState(phase = QaPhase.Streaming, committedText = "prev")
                .onChunk(AiQaChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(QaPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiQaState(phase = QaPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(QaPhase.Done, promoted.phase)
        val untouched = AiQaState(phase = QaPhase.Failed).finishIfStreaming(9L)
        assertEquals(QaPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyQa(AiQaState(gateEnabled = false, vehicleId = 1L, question = "q"), nowMs = 0L)
        assertEquals(QaSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            QaSurface.Resting(canStart = true),
            classifyQa(AiQaState(vehicleId = 1L, question = "q"), nowMs = 0L),
        )
        assertEquals(
            QaSurface.Resting(canStart = false),
            classifyQa(AiQaState(vehicleId = 1L, question = ""), nowMs = 0L),
        )
        assertEquals(
            QaSurface.Resting(canStart = false),
            classifyQa(AiQaState(vehicleId = null, question = "q"), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyQa(AiQaState(vehicleId = 1L, question = "q", phase = QaPhase.Streaming), nowMs = 0L)
        assertEquals(QaSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyQa(
                AiQaState(vehicleId = 1L, question = "q", phase = QaPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(QaSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyQa(
                AiQaState(
                    vehicleId = 1L,
                    question = "q",
                    phase = QaPhase.Done,
                    committedText = "answered",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(QaSurface.Ready("answered", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyQa(
                AiQaState(
                    vehicleId = 1L,
                    question = "q",
                    phase = QaPhase.Done,
                    committedText = "answered",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(QaSurface.Ready("answered", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyQa(
                AiQaState(vehicleId = 1L, question = "q", phase = QaPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(QaSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyQa(
                AiQaState(
                    vehicleId = 1L,
                    question = "q",
                    phase = QaPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(QaSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyQa(
                AiQaState(
                    vehicleId = 1L,
                    question = "q",
                    phase = QaPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(QaSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyQa(
                AiQaState(vehicleId = 1L, question = "q", phase = QaPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(QaSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyQa(
                AiQaState(vehicleId = 1L, question = "q", phase = QaPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(QaSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Ask about your lifetime stats", "Helix", "Ask Helix a question.")
        assertEquals("Ask about your lifetime stats (Helix). Ask Helix a question.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            QaOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(QaSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(QaSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(QaSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(QaSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(QaSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(QaSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(QaSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(QaSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = QaOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(QaSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(QaSurface.Hidden, labels))
    }
}
