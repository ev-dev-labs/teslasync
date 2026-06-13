// Off-device unit tests for the pure AIChargingDiagnosis model: the stream reducer, the surface classifier
// (every loading / empty / content / error / stale / offline branch the web component resolves), the freshness
// rule, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aichargingdiagnosis

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIChargingDiagnosisModelTest {
    private val window = DIAGNOSIS_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiDiagnosisState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(DiagnosisPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiDiagnosisState(phase = DiagnosisPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(DiagnosisPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiDiagnosisState(phase = DiagnosisPhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(DiagnosisPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiDiagnosisState(phase = DiagnosisPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(DiagnosisPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiDiagnosisState(phase = DiagnosisPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DiagnosisPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiDiagnosisState(phase = DiagnosisPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DiagnosisPhase.Done, promoted.phase)
        val untouched = AiDiagnosisState(phase = DiagnosisPhase.Failed).finishIfStreaming(9L)
        assertEquals(DiagnosisPhase.Failed, untouched.phase)
    }

    // ── canStart parity with web `!!sessionId` ──────────────────────────────────────
    @Test
    fun canStartMirrorsTruthySessionId() {
        assertTrue(AiDiagnosisState(sessionId = "1023").canStart)
        assertFalse(AiDiagnosisState(sessionId = "").canStart)
        assertFalse(AiDiagnosisState(sessionId = null).canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyDiagnosis(AiDiagnosisState(gateEnabled = false, sessionId = "1023"), nowMs = 0L)
        assertEquals(DiagnosisSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            DiagnosisSurface.Resting(canStart = true),
            classifyDiagnosis(AiDiagnosisState(sessionId = "1023"), nowMs = 0L),
        )
        assertEquals(
            DiagnosisSurface.Resting(canStart = false),
            classifyDiagnosis(AiDiagnosisState(sessionId = null), nowMs = 0L),
        )
        assertEquals(
            DiagnosisSurface.Resting(canStart = false),
            classifyDiagnosis(AiDiagnosisState(sessionId = ""), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyDiagnosis(AiDiagnosisState(sessionId = "1023", phase = DiagnosisPhase.Streaming), nowMs = 0L)
        assertEquals(DiagnosisSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(sessionId = "1023", phase = DiagnosisPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(DiagnosisSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(
                    sessionId = "1023",
                    phase = DiagnosisPhase.Done,
                    committedText = "diagnosed",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(DiagnosisSurface.Ready("diagnosed", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(
                    sessionId = "1023",
                    phase = DiagnosisPhase.Done,
                    committedText = "diagnosed",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(DiagnosisSurface.Ready("diagnosed", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(sessionId = "1023", phase = DiagnosisPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(DiagnosisSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(
                    sessionId = "1023",
                    phase = DiagnosisPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(DiagnosisSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(
                    sessionId = "1023",
                    phase = DiagnosisPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(DiagnosisSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(sessionId = "1023", phase = DiagnosisPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DiagnosisSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyDiagnosis(
                AiDiagnosisState(sessionId = "1023", phase = DiagnosisPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(DiagnosisSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Charging diagnosis", "Helix", "Get a plain-language explanation.")
        assertEquals("Charging diagnosis (Helix). Get a plain-language explanation.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            DiagnosisOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(DiagnosisSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(DiagnosisSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(DiagnosisSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(DiagnosisSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(DiagnosisSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(DiagnosisSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(DiagnosisSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(DiagnosisSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = DiagnosisOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(DiagnosisSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(DiagnosisSurface.Hidden, labels))
    }
}
