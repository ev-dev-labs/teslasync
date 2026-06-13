// Off-device unit tests for the pure AINLAutomationBuilder model: the prompt+vehicle canStart guard (web
// `vehicleId != null && prompt.trim().length > 0`), the stream reducer, the surface classifier (every loading /
// empty / content / error / stale / offline branch the web component resolves), the freshness rule, the
// accessibility-label builders (TalkBack-label presence), and the i18n key fold + fallback resolution. Run by
// the offline :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlautomationbuilder

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AINLAutomationBuilderModelTest {
    private val window = DRAFT_FRESHNESS_WINDOW_MS

    // ── canStart guard (web `vehicleId != null && prompt.trim().length > 0`) ─────────
    @Test
    fun canStartRequiresVehicleAndNonBlankPrompt() {
        assertTrue(AiDraftState(vehicleId = 1L, prompt = "precondition cabin").canStart)
        assertFalse(AiDraftState(vehicleId = 1L, prompt = "").canStart)
        assertFalse(AiDraftState(vehicleId = 1L, prompt = "   ").canStart)
        assertFalse(AiDraftState(vehicleId = null, prompt = "precondition cabin").canStart)
        assertFalse(AiDraftState(vehicleId = null, prompt = "").canStart)
    }

    @Test
    fun canStartTrimsSurroundingWhitespace() {
        assertTrue(AiDraftState(vehicleId = 2L, prompt = "  draft me  ").canStart)
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiDraftState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept", prompt = "p")
                .startGenerating()
        assertEquals(DraftPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
        assertEquals("p", next.prompt)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiDraftChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiDraftChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiDraftState(phase = DraftPhase.Streaming, streamingText = "draft graph")
                .onChunk(AiDraftChunk.Done, nowMs = 42L)
        assertEquals(DraftPhase.Done, next.phase)
        assertEquals("draft graph", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiDraftState(phase = DraftPhase.Streaming, streamingText = "   ")
                .onChunk(AiDraftChunk.Done, nowMs = 7L)
        assertEquals(DraftPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiDraftState(phase = DraftPhase.Streaming, committedText = "prev")
                .onChunk(AiDraftChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DraftPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiDraftState(phase = DraftPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DraftPhase.Done, promoted.phase)
        val untouched = AiDraftState(phase = DraftPhase.Failed).finishIfStreaming(9L)
        assertEquals(DraftPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyDraft(AiDraftState(gateEnabled = false, vehicleId = 1L, prompt = "p"), nowMs = 0L)
        assertEquals(DraftSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            DraftSurface.Resting(canStart = true),
            classifyDraft(AiDraftState(vehicleId = 1L, prompt = "draft me"), nowMs = 0L),
        )
        assertEquals(
            DraftSurface.Resting(canStart = false),
            classifyDraft(AiDraftState(vehicleId = 1L, prompt = ""), nowMs = 0L),
        )
        assertEquals(
            DraftSurface.Resting(canStart = false),
            classifyDraft(AiDraftState(vehicleId = null, prompt = "draft me"), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyDraft(AiDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Streaming), nowMs = 0L)
        assertEquals(DraftSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyDraft(
                AiDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyDraft(
                AiDraftState(
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
                AiDraftState(
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
                AiDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyDraft(
                AiDraftState(
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
                AiDraftState(
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
                AiDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyDraft(
                AiDraftState(vehicleId = 1L, prompt = "p", phase = DraftPhase.Failed, errorKind = ErrorKind.Http),
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
        val label = headerAccessibilityLabel("Draft from natural language", "Helix", "Describe the automation.")
        assertEquals("Draft from natural language (Helix). Describe the automation.", label)
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

    // ── i18n key fold + fallback ─────────────────────────────────────────────────────
    @Test
    fun foldCatalogKeyMatchesGeneratedResourceName() {
        assertEquals(
            "translation_automations_builder_aiBuilder_title",
            foldCatalogKey(AINLAutomationBuilderKeys.TITLE),
        )
        assertEquals(
            "translation_automations_builder_aiBuilder_placeholder",
            foldCatalogKey(AINLAutomationBuilderKeys.PROMPT_HINT),
        )
    }

    @Test
    fun fallbackResolverReturnsWebEnglishForEveryLabel() {
        val labels = aiNlAutomationBuilderLabels(FallbackResolver)
        assertEquals(AINLAutomationBuilderKeys.TITLE_EN, labels.title)
        assertEquals(AINLAutomationBuilderKeys.DESCRIPTION_EN, labels.description)
        assertEquals(AINLAutomationBuilderKeys.BADGE_EN, labels.badge)
        assertEquals(AINLAutomationBuilderKeys.DRAFT_BUTTON_EN, labels.draftButton)
        assertEquals(AINLAutomationBuilderKeys.PROMPT_HINT_EN, labels.promptHint)
    }

    @Test
    fun resolverReadsCatalogWhenPresentAndFallsBackWhenAbsent() {
        // Simulates the production by-name resolver: the four present keys resolve from the catalog; the
        // prompt hint (absent from the web catalog, web parity) resolves through the inline English fallback.
        val catalog =
            mapOf(
                foldCatalogKey(AINLAutomationBuilderKeys.TITLE) to "Localized title",
                foldCatalogKey(AINLAutomationBuilderKeys.DESCRIPTION) to "Localized description",
                foldCatalogKey(AINLAutomationBuilderKeys.BADGE) to "Helix",
                foldCatalogKey(AINLAutomationBuilderKeys.DRAFT_BUTTON) to "Localized draft",
            )
        val resolve: StringResolver = { key, fallback -> catalog[foldCatalogKey(key)] ?: fallback }
        val labels = aiNlAutomationBuilderLabels(resolve)
        assertEquals("Localized title", labels.title)
        assertEquals("Localized draft", labels.draftButton)
        assertEquals(AINLAutomationBuilderKeys.PROMPT_HINT_EN, labels.promptHint)
    }
}
