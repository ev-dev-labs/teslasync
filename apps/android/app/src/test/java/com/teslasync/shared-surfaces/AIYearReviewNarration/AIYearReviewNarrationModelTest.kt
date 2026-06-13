// Off-device unit tests for the pure AIYearReviewNarration model: the stream reducer, the surface classifier (every
// loading / empty / content / error / stale / offline branch the web component resolves), the freshness rule, the
// derived review-year, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiyearreviewnarration

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIYearReviewNarrationModelTest {
    private val window = NARRATION_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiNarrationState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(NarrationPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiNarrationState(phase = NarrationPhase.Streaming)
                .onChunk(AiNarrationChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiNarrationChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(NarrationPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiNarrationState(phase = NarrationPhase.Streaming, streamingText = "done text")
                .onChunk(AiNarrationChunk.Done, nowMs = 42L)
        assertEquals(NarrationPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiNarrationState(phase = NarrationPhase.Streaming, streamingText = "   ")
                .onChunk(AiNarrationChunk.Done, nowMs = 7L)
        assertEquals(NarrationPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiNarrationState(phase = NarrationPhase.Streaming, committedText = "prev")
                .onChunk(AiNarrationChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(NarrationPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiNarrationState(phase = NarrationPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(NarrationPhase.Done, promoted.phase)
        val untouched = AiNarrationState(phase = NarrationPhase.Failed).finishIfStreaming(9L)
        assertEquals(NarrationPhase.Failed, untouched.phase)
    }

    // ── canStart ────────────────────────────────────────────────────────────────────
    @Test
    fun canStartReflectsSelectedVehicle() {
        assertTrue(AiNarrationState(vehicleId = 1L).canStart)
        assertFalse(AiNarrationState(vehicleId = null).canStart)
    }

    // ── derived review year ──────────────────────────────────────────────────────────
    @Test
    fun defaultReviewYearIsPreviousCalendarYear() {
        assertEquals(2024, defaultReviewYear(now = 2025))
        assertEquals(1999, defaultReviewYear(now = 2000))
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyNarration(AiNarrationState(gateEnabled = false, vehicleId = 1L), nowMs = 0L)
        assertEquals(NarrationSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            NarrationSurface.Resting(canStart = true),
            classifyNarration(AiNarrationState(vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            NarrationSurface.Resting(canStart = false),
            classifyNarration(AiNarrationState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyNarration(AiNarrationState(vehicleId = 1L, phase = NarrationPhase.Streaming), nowMs = 0L)
        assertEquals(NarrationSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyNarration(
                AiNarrationState(vehicleId = 1L, phase = NarrationPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyNarration(
                AiNarrationState(
                    vehicleId = 1L,
                    phase = NarrationPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(NarrationSurface.Ready("narrated", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyNarration(
                AiNarrationState(
                    vehicleId = 1L,
                    phase = NarrationPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(NarrationSurface.Ready("narrated", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyNarration(
                AiNarrationState(vehicleId = 1L, phase = NarrationPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyNarration(
                AiNarrationState(
                    vehicleId = 1L,
                    phase = NarrationPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyNarration(
                AiNarrationState(
                    vehicleId = 1L,
                    phase = NarrationPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyNarration(
                AiNarrationState(vehicleId = 1L, phase = NarrationPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyNarration(
                AiNarrationState(vehicleId = 1L, phase = NarrationPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Failed(offline = false), surface)
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
        val label =
            headerAccessibilityLabel("Helix narration", "Helix", "Get a short, Helix-written recap of your year.")
        assertEquals("Helix narration (Helix). Get a short, Helix-written recap of your year.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            NarrationOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(NarrationSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(NarrationSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(NarrationSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(NarrationSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(NarrationSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(NarrationSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(NarrationSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(NarrationSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = NarrationOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(NarrationSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(NarrationSurface.Hidden, labels))
    }
}
