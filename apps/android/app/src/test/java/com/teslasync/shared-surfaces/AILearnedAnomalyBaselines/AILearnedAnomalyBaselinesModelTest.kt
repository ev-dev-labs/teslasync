// Off-device unit tests for the pure AILearnedAnomalyBaselines model: the days-window guard, the stream
// reducer, the surface classifier (every loading / empty / content / error / stale / offline branch the web
// component resolves), the freshness rule, and the accessibility-label builders (TalkBack-label presence). Run
// by the offline :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailearnedanomalybaselines

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AILearnedAnomalyBaselinesModelTest {
    private val window = BASELINE_FRESHNESS_WINDOW_MS

    // ── days window guard ───────────────────────────────────────────────────────────
    @Test
    fun normalizeDaysCoercesNonPositiveToDefaultAndKeepsPositive() {
        assertEquals(ANOMALY_BASELINE_DEFAULT_DAYS, normalizeDays(0))
        assertEquals(ANOMALY_BASELINE_DEFAULT_DAYS, normalizeDays(-7))
        assertEquals(ANOMALY_BASELINE_DEFAULT_DAYS, normalizeDays(ANOMALY_BASELINE_DEFAULT_DAYS))
        assertEquals(7, normalizeDays(7))
    }

    @Test
    fun normalizeDaysDoesNotClampAboveServerMax() {
        // The trainer caps wider windows server-side (anomaly.MaxDays); the client stays faithful.
        assertEquals(ANOMALY_BASELINE_MAX_DAYS + 60, normalizeDays(ANOMALY_BASELINE_MAX_DAYS + 60))
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiBaselineState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(TrainingPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiBaselineState(phase = TrainingPhase.Streaming)
                .onChunk(AiBaselineChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiBaselineChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(TrainingPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiBaselineState(phase = TrainingPhase.Streaming, streamingText = "done text")
                .onChunk(AiBaselineChunk.Done, nowMs = 42L)
        assertEquals(TrainingPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiBaselineState(phase = TrainingPhase.Streaming, streamingText = "   ")
                .onChunk(AiBaselineChunk.Done, nowMs = 7L)
        assertEquals(TrainingPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiBaselineState(phase = TrainingPhase.Streaming, committedText = "prev")
                .onChunk(AiBaselineChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(TrainingPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiBaselineState(phase = TrainingPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(TrainingPhase.Done, promoted.phase)
        val untouched = AiBaselineState(phase = TrainingPhase.Failed).finishIfStreaming(9L)
        assertEquals(TrainingPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyBaseline(AiBaselineState(gateEnabled = false, vehicleId = 1L), nowMs = 0L)
        assertEquals(BaselineSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            BaselineSurface.Resting(canStart = true),
            classifyBaseline(AiBaselineState(vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            BaselineSurface.Resting(canStart = false),
            classifyBaseline(AiBaselineState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyBaseline(AiBaselineState(vehicleId = 1L, phase = TrainingPhase.Streaming), nowMs = 0L)
        assertEquals(BaselineSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyBaseline(
                AiBaselineState(vehicleId = 1L, phase = TrainingPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(BaselineSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyBaseline(
                AiBaselineState(
                    vehicleId = 1L,
                    phase = TrainingPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(BaselineSurface.Ready("narrated", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyBaseline(
                AiBaselineState(
                    vehicleId = 1L,
                    phase = TrainingPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(BaselineSurface.Ready("narrated", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyBaseline(
                AiBaselineState(vehicleId = 1L, phase = TrainingPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(BaselineSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyBaseline(
                AiBaselineState(
                    vehicleId = 1L,
                    phase = TrainingPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(BaselineSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyBaseline(
                AiBaselineState(
                    vehicleId = 1L,
                    phase = TrainingPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(BaselineSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyBaseline(
                AiBaselineState(vehicleId = 1L, phase = TrainingPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(BaselineSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyBaseline(
                AiBaselineState(vehicleId = 1L, phase = TrainingPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(BaselineSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Learn per-vehicle baseline", "Helix", "Compute anomaly bounds.")
        assertEquals("Learn per-vehicle baseline (Helix). Compute anomaly bounds.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            BaselineOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(BaselineSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(BaselineSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(BaselineSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(BaselineSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(BaselineSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(BaselineSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(BaselineSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(BaselineSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = BaselineOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(BaselineSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(BaselineSurface.Hidden, labels))
    }
}
