// Off-device unit tests for the pure AIRouteEfficiencySuggestions model: the stream reducer, the surface
// classifier (every loading / empty / content / error / stale / offline branch the web component resolves),
// the freshness rule, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.airouteefficiencysuggestions

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIRouteEfficiencySuggestionsModelTest {
    private val window = ROUTE_EFFICIENCY_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiSuggestionsState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(SuggestionPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiSuggestionsState(phase = SuggestionPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(SuggestionPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiSuggestionsState(phase = SuggestionPhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(SuggestionPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiSuggestionsState(phase = SuggestionPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(SuggestionPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiSuggestionsState(phase = SuggestionPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(SuggestionPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiSuggestionsState(phase = SuggestionPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(SuggestionPhase.Done, promoted.phase)
        val untouched = AiSuggestionsState(phase = SuggestionPhase.Failed).finishIfStreaming(9L)
        assertEquals(SuggestionPhase.Failed, untouched.phase)
    }

    // ── canStart parity with web !!vehicleId ────────────────────────────────────────
    @Test
    fun canStartMirrorsTruthyVehicleId() {
        assertTrue(AiSuggestionsState(vehicleId = "vehicle-1").canStart)
        assertFalse(AiSuggestionsState(vehicleId = null).canStart)
        assertFalse(AiSuggestionsState(vehicleId = "").canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifySuggestions(AiSuggestionsState(gateEnabled = false, vehicleId = "vehicle-1"), nowMs = 0L)
        assertEquals(SuggestionsSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            SuggestionsSurface.Resting(canStart = true),
            classifySuggestions(AiSuggestionsState(vehicleId = "vehicle-1"), nowMs = 0L),
        )
        assertEquals(
            SuggestionsSurface.Resting(canStart = false),
            classifySuggestions(AiSuggestionsState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(vehicleId = "vehicle-1", phase = SuggestionPhase.Streaming),
                nowMs = 0L,
            )
        assertEquals(SuggestionsSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(
                    vehicleId = "vehicle-1",
                    phase = SuggestionPhase.Streaming,
                    streamingText = "partial",
                ),
                nowMs = 0L,
            )
        assertEquals(SuggestionsSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(
                    vehicleId = "vehicle-1",
                    phase = SuggestionPhase.Done,
                    committedText = "suggested",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(SuggestionsSurface.Ready("suggested", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(
                    vehicleId = "vehicle-1",
                    phase = SuggestionPhase.Done,
                    committedText = "suggested",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(SuggestionsSurface.Ready("suggested", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(vehicleId = "vehicle-1", phase = SuggestionPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(SuggestionsSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(
                    vehicleId = "vehicle-1",
                    phase = SuggestionPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(SuggestionsSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(
                    vehicleId = "vehicle-1",
                    phase = SuggestionPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(SuggestionsSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(
                    vehicleId = "vehicle-1",
                    phase = SuggestionPhase.Failed,
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(SuggestionsSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifySuggestions(
                AiSuggestionsState(
                    vehicleId = "vehicle-1",
                    phase = SuggestionPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(SuggestionsSurface.Failed(offline = false), surface)
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
            headerAccessibilityLabel(
                "Route-efficiency suggestions",
                "Helix",
                "Get a short plain-language suggestion for lower-consumption habits.",
            )
        assertEquals(
            "Route-efficiency suggestions (Helix). Get a short plain-language suggestion for lower-consumption habits.",
            label,
        )
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            SuggestionsOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(SuggestionsSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(SuggestionsSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(SuggestionsSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(SuggestionsSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(SuggestionsSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(SuggestionsSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(SuggestionsSurface.Cached("cached", offline = false), labels),
        )
        assertEquals(
            "Failed to load data",
            outputAccessibilityLabel(SuggestionsSurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = SuggestionsOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(SuggestionsSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(SuggestionsSurface.Hidden, labels))
    }
}
