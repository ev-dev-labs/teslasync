// Off-device unit tests for the pure AIStateMachineDebuggerNarrator model: the (vehicle, window) scope guard
// (web `haveScope` — vehicleId > 0, fromUnix > 0, toUnix > fromUnix), the stream reducer, the surface
// classifier (every loading / empty / content / error / stale / offline branch the web component resolves),
// the freshness rule, the empty-hint visibility (web `!canStart && emptyHint`), and the accessibility-label
// builders (TalkBack-label presence). Run by the offline :android:testReleaseUnitTest gate — no Compose, no
// Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aistatemachinedebuggernarrator

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIStateMachineDebuggerNarratorModelTest {
    private val window = NARRATION_FRESHNESS_WINDOW_MS

    private fun validScope() = NarrationScope(vehicleId = 1L, fromUnix = 100L, toUnix = 200L)

    // ── scope guard (web haveScope) ─────────────────────────────────────────────────
    @Test
    fun scopeIsValidForCompletePositiveOrderedTriple() {
        assertTrue(validScope().isValid)
    }

    @Test
    fun scopeIsInvalidWhenAnyComponentMissing() {
        assertFalse(NarrationScope(vehicleId = null, fromUnix = 100L, toUnix = 200L).isValid)
        assertFalse(NarrationScope(vehicleId = 1L, fromUnix = null, toUnix = 200L).isValid)
        assertFalse(NarrationScope(vehicleId = 1L, fromUnix = 100L, toUnix = null).isValid)
        assertFalse(NarrationScope().isValid)
    }

    @Test
    fun scopeIsInvalidForNonPositiveVehicleOrStart() {
        assertFalse(NarrationScope(vehicleId = 0L, fromUnix = 100L, toUnix = 200L).isValid)
        assertFalse(NarrationScope(vehicleId = -3L, fromUnix = 100L, toUnix = 200L).isValid)
        assertFalse(NarrationScope(vehicleId = 1L, fromUnix = 0L, toUnix = 200L).isValid)
        assertFalse(NarrationScope(vehicleId = 1L, fromUnix = -5L, toUnix = 200L).isValid)
    }

    @Test
    fun scopeIsInvalidWhenEndNotStrictlyAfterStart() {
        assertFalse(NarrationScope(vehicleId = 1L, fromUnix = 200L, toUnix = 200L).isValid)
        assertFalse(NarrationScope(vehicleId = 1L, fromUnix = 200L, toUnix = 100L).isValid)
    }

    @Test
    fun validatedYieldsTripleOnlyForValidScope() {
        assertEquals(Triple(1L, 100L, 200L), validScope().validated)
        assertNull(NarrationScope(vehicleId = 0L, fromUnix = 100L, toUnix = 200L).validated)
        assertNull(NarrationScope(vehicleId = 1L, fromUnix = 200L, toUnix = 100L).validated)
        assertNull(NarrationScope(vehicleId = 1L, fromUnix = 100L, toUnix = null).validated)
        assertNull(NarrationScope().validated)
    }

    @Test
    fun canStartTracksScopeValidity() {
        assertTrue(AiNarrationState(scope = validScope()).canStart)
        assertFalse(AiNarrationState(scope = NarrationScope(vehicleId = 1L, fromUnix = 200L, toUnix = 100L)).canStart)
    }

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

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyNarration(AiNarrationState(gateEnabled = false, scope = validScope()), nowMs = 0L)
        assertEquals(NarrationSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            NarrationSurface.Resting(canStart = true),
            classifyNarration(AiNarrationState(scope = validScope()), nowMs = 0L),
        )
        assertEquals(
            NarrationSurface.Resting(canStart = false),
            classifyNarration(AiNarrationState(scope = NarrationScope()), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyNarration(AiNarrationState(scope = validScope(), phase = NarrationPhase.Streaming), nowMs = 0L)
        assertEquals(NarrationSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyNarration(
                AiNarrationState(scope = validScope(), phase = NarrationPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyNarration(
                AiNarrationState(
                    scope = validScope(),
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
                    scope = validScope(),
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
                AiNarrationState(scope = validScope(), phase = NarrationPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyNarration(
                AiNarrationState(
                    scope = validScope(),
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
                    scope = validScope(),
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
                AiNarrationState(scope = validScope(), phase = NarrationPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(NarrationSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyNarration(
                AiNarrationState(scope = validScope(), phase = NarrationPhase.Failed, errorKind = ErrorKind.Http),
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

    // ── empty hint (web `!canStart && emptyHint`) ───────────────────────────────────
    @Test
    fun restingHintShowsOnlyWhenActionDisabled() {
        assertNull(restingHint(canStart = true, hint = "Select a vehicle and a valid time window first."))
        assertEquals(
            "Select a vehicle and a valid time window first.",
            restingHint(canStart = false, hint = "Select a vehicle and a valid time window first."),
        )
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────
    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        val label = headerAccessibilityLabel("Helix FSM narrator", "Helix", "Narrate the FSM trace.")
        assertEquals("Helix FSM narrator (Helix). Narrate the FSM trace.", label)
    }

    @Test
    fun headerLabelAppendsHintWhenScopeIncomplete() {
        val label =
            headerAccessibilityLabel(
                title = "Helix FSM narrator",
                badge = "Helix",
                description = "Narrate the FSM trace.",
                hint = "Select a vehicle and a valid time window first.",
            )
        assertEquals(
            "Helix FSM narrator (Helix). Narrate the FSM trace. Select a vehicle and a valid time window first.",
            label,
        )
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
