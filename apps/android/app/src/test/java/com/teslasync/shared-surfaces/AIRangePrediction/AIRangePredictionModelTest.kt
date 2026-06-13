// Off-device unit tests for the pure AIRangePrediction model: the training-window resolver, the stream
// reducer, the surface classifier (every loading / empty / content / error / stale / offline branch the web
// component resolves), the freshness rule, and the accessibility-label builders (TalkBack-label presence). Run
// by the offline :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.airangeprediction

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIRangePredictionModelTest {
    private val window = RANGE_MODEL_FRESHNESS_WINDOW_MS

    // ── training-window resolver ─────────────────────────────────────────────────────
    @Test
    fun normalizeDaysDefaultsToWebFourteenWhenAbsent() {
        assertEquals(RANGE_MODEL_TRAINING_DAYS, normalizeDays(null))
        assertEquals(14, normalizeDays(14))
    }

    @Test
    fun normalizeDaysClampsToServerBounds() {
        // Non-positive windows clamp up to 1; wider-than-MaxDays clamp down to the trainer's cap.
        assertEquals(1, normalizeDays(0))
        assertEquals(1, normalizeDays(-7))
        assertEquals(RANGE_MODEL_MAX_DAYS, normalizeDays(40))
        assertEquals(30, normalizeDays(30))
        assertEquals(21, normalizeDays(21))
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startTrainingEntersStreamingAndClearsTransients() {
        val next =
            RangeModelState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startTraining()
        assertEquals(RangeModelPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            RangeModelState(phase = RangeModelPhase.Streaming)
                .onChunk(RangeModelChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(RangeModelChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(RangeModelPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            RangeModelState(phase = RangeModelPhase.Streaming, streamingText = "done text")
                .onChunk(RangeModelChunk.Done, nowMs = 42L)
        assertEquals(RangeModelPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            RangeModelState(phase = RangeModelPhase.Streaming, streamingText = "   ")
                .onChunk(RangeModelChunk.Done, nowMs = 7L)
        assertEquals(RangeModelPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            RangeModelState(phase = RangeModelPhase.Streaming, committedText = "prev")
                .onChunk(RangeModelChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(RangeModelPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = RangeModelState(phase = RangeModelPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(RangeModelPhase.Done, promoted.phase)
        val untouched = RangeModelState(phase = RangeModelPhase.Failed).finishIfStreaming(9L)
        assertEquals(RangeModelPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyRangeModel(RangeModelState(gateEnabled = false, vehicleId = 1L), nowMs = 0L)
        assertEquals(RangeModelSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            RangeModelSurface.Resting(canStart = true),
            classifyRangeModel(RangeModelState(vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            RangeModelSurface.Resting(canStart = false),
            classifyRangeModel(RangeModelState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyRangeModel(RangeModelState(vehicleId = 1L, phase = RangeModelPhase.Streaming), nowMs = 0L)
        assertEquals(RangeModelSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyRangeModel(
                RangeModelState(vehicleId = 1L, phase = RangeModelPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(RangeModelSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyRangeModel(
                RangeModelState(
                    vehicleId = 1L,
                    phase = RangeModelPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(RangeModelSurface.Ready("narrated", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyRangeModel(
                RangeModelState(
                    vehicleId = 1L,
                    phase = RangeModelPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(RangeModelSurface.Ready("narrated", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyRangeModel(
                RangeModelState(vehicleId = 1L, phase = RangeModelPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(RangeModelSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyRangeModel(
                RangeModelState(
                    vehicleId = 1L,
                    phase = RangeModelPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(RangeModelSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyRangeModel(
                RangeModelState(
                    vehicleId = 1L,
                    phase = RangeModelPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(RangeModelSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyRangeModel(
                RangeModelState(vehicleId = 1L, phase = RangeModelPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(RangeModelSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyRangeModel(
                RangeModelState(vehicleId = 1L, phase = RangeModelPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(RangeModelSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Learn per-vehicle range model", "Helix", "Train range model.")
        assertEquals("Learn per-vehicle range model (Helix). Train range model.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            RangeModelOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(RangeModelSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(RangeModelSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(RangeModelSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(RangeModelSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(RangeModelSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(RangeModelSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(RangeModelSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(RangeModelSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = RangeModelOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(RangeModelSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(RangeModelSurface.Hidden, labels))
    }
}
