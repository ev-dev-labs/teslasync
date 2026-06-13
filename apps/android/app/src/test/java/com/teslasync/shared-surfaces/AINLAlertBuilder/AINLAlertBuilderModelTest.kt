// Off-device unit tests for the pure AINLAlertBuilder model: the vehicle + non-blank-prompt `canStart`
// predicate, the prompt binder, the stream reducer, the surface classifier (every loading / empty / content /
// error / stale / offline branch the web component resolves), the freshness rule, and the accessibility-label
// builders (TalkBack-label presence). Run by the offline :android:testReleaseUnitTest gate — no Compose, no
// Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlalertbuilder

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AINLAlertBuilderModelTest {
    private val window = DRAFT_FRESHNESS_WINDOW_MS

    // ── canStart: vehicle AND non-blank prompt ──────────────────────────────────────
    @Test
    fun canStartRequiresVehicleAndNonBlankPrompt() {
        assertTrue(AiAlertDraftState(vehicleId = 1L, prompt = "spread > 50 mV").canStart)
        assertFalse(AiAlertDraftState(vehicleId = 1L, prompt = "").canStart)
        assertFalse(AiAlertDraftState(vehicleId = 1L, prompt = "   ").canStart)
        assertFalse(AiAlertDraftState(vehicleId = null, prompt = "spread > 50 mV").canStart)
    }

    @Test
    fun withPromptBindsLivePrompt() {
        val next = AiAlertDraftState(vehicleId = 1L).withPrompt("draft me an alert")
        assertEquals("draft me an alert", next.prompt)
        assertTrue(next.canStart)
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startDraftingEntersStreamingAndClearsTransients() {
        val next =
            AiAlertDraftState(
                prompt = "keep me",
                streamingText = "old",
                errorKind = ErrorKind.Http,
                committedText = "kept",
            ).startDrafting()
        assertEquals(DraftPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
        assertEquals("keep me", next.prompt)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiAlertDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiDraftChunk.Delta("Aler"), nowMs = 1L)
                .onChunk(AiDraftChunk.Delta("tRule"), nowMs = 2L)
        assertEquals("AlertRule", next.streamingText)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiAlertDraftState(phase = DraftPhase.Streaming, streamingText = "draft text")
                .onChunk(AiDraftChunk.Done, nowMs = 42L)
        assertEquals(DraftPhase.Done, next.phase)
        assertEquals("draft text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiAlertDraftState(phase = DraftPhase.Streaming, streamingText = "   ")
                .onChunk(AiDraftChunk.Done, nowMs = 7L)
        assertEquals(DraftPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiAlertDraftState(phase = DraftPhase.Streaming, committedText = "prev")
                .onChunk(AiDraftChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DraftPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiAlertDraftState(phase = DraftPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DraftPhase.Done, promoted.phase)
        val untouched = AiAlertDraftState(phase = DraftPhase.Failed).finishIfStreaming(9L)
        assertEquals(DraftPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyDraft(AiAlertDraftState(gateEnabled = false, vehicleId = 1L, prompt = "p"), nowMs = 0L)
        assertEquals(DraftSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            DraftSurface.Resting(canStart = true),
            classifyDraft(AiAlertDraftState(vehicleId = 1L, prompt = "p"), nowMs = 0L),
        )
        assertEquals(
            DraftSurface.Resting(canStart = false),
            classifyDraft(AiAlertDraftState(vehicleId = null, prompt = "p"), nowMs = 0L),
        )
        assertEquals(
            DraftSurface.Resting(canStart = false),
            classifyDraft(AiAlertDraftState(vehicleId = 1L, prompt = ""), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyDraft(AiAlertDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Streaming), nowMs = 0L)
        assertEquals(DraftSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyDraft(
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = "p",
                    phase = DraftPhase.Streaming,
                    streamingText = "partial",
                ),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyDraft(
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = "p",
                    phase = DraftPhase.Done,
                    committedText = "drafted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(DraftSurface.Ready("drafted", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyDraft(
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = "p",
                    phase = DraftPhase.Done,
                    committedText = "drafted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(DraftSurface.Ready("drafted", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyDraft(
                AiAlertDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyDraft(
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = "p",
                    phase = DraftPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyDraft(
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = "p",
                    phase = DraftPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyDraft(
                AiAlertDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyDraft(
                AiAlertDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Draft from natural language", "Helix", "Describe the alert you want.")
        assertEquals("Draft from natural language (Helix). Describe the alert you want.", label)
    }

    @Test
    fun promptInputLabelMergesPurposeAndHint() {
        val label = promptInputAccessibilityLabel("Draft from natural language", "e.g. alert me if spread > 50 mV")
        assertEquals("Draft from natural language. e.g. alert me if spread > 50 mV", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            DraftOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(DraftSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(DraftSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(DraftSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(DraftSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(DraftSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(DraftSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(DraftSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(DraftSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = DraftOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(DraftSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(DraftSurface.Hidden, labels))
    }
}
