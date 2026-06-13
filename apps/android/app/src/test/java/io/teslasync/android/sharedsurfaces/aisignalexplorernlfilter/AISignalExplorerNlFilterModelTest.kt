// Off-device unit tests for the pure AISignalExplorerNlFilter model: the `draft_signal_filter` tool_result parser
// (web `parseSignalFilterDraft`, every reject + accept branch — including the web `signals.every(isString)` guard
// that rejects the WHOLE draft on any non-string signal), the stream reducer, the surface classifier (every
// loading / empty / content / error / stale / offline branch the web component resolves), the freshness rule, the
// resolved-label facade, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aisignalexplorernlfilter

import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AISignalExplorerNlFilterModelTest {
    private val window = DRAFT_FRESHNESS_WINDOW_MS

    private fun json(raw: String): JsonElement = Json.parseToJsonElement(raw)

    // ── parseSignalFilterDraft: accept ─────────────────────────────────────────────
    @Test
    fun parsesAWellFormedOkDraft() {
        val data =
            json(
                """{"status":"ok","draft":{"vehicle_id":7,"signals":["battery_level","charge_state"],""" +
                    """"range_preset":"yesterday","per_page":100}}""",
            )
        assertEquals(
            SignalFilterDraft(7L, listOf("battery_level", "charge_state"), "yesterday", 100),
            parseSignalFilterDraft(data),
        )
    }

    @Test
    fun emptySignalsArrayIsAccepted() {
        val data = json("""{"status":"ok","draft":{"vehicle_id":7,"signals":[],"range_preset":"24h","per_page":50}}""")
        assertEquals(emptyList<String>(), parseSignalFilterDraft(data)?.signals)
    }

    // ── parseSignalFilterDraft: reject ─────────────────────────────────────────────
    @Test
    fun anyNonStringSignalRejectsTheWholeDraft() {
        // Web `signals.every(s => typeof s === 'string')` — a single non-string entry rejects the entire draft
        // (unlike the SQL surface's filter-to-strings behaviour). This is the parity-critical divergence.
        val data =
            json("""{"status":"ok","draft":{"vehicle_id":7,"signals":["a",1,"b"],"range_preset":"24h","per_page":50}}""")
        assertNull(parseSignalFilterDraft(data))
    }

    @Test
    fun nullPayloadIsRejected() {
        assertNull(parseSignalFilterDraft(null))
    }

    @Test
    fun nonObjectPayloadIsRejected() {
        assertNull(parseSignalFilterDraft(json("123")))
    }

    @Test
    fun nonOkStatusIsRejected() {
        assertNull(
            parseSignalFilterDraft(
                json("""{"status":"error","draft":{"vehicle_id":7,"signals":[],"range_preset":"24h","per_page":50}}"""),
            ),
        )
    }

    @Test
    fun missingDraftObjectIsRejected() {
        assertNull(parseSignalFilterDraft(json("""{"status":"ok"}""")))
    }

    @Test
    fun nonObjectDraftIsRejected() {
        assertNull(parseSignalFilterDraft(json("""{"status":"ok","draft":"nope"}""")))
    }

    @Test
    fun missingOrNonNumberVehicleIdIsRejected() {
        assertNull(parseSignalFilterDraft(json("""{"status":"ok","draft":{"signals":[],"range_preset":"24h","per_page":50}}""")))
        assertNull(
            parseSignalFilterDraft(
                json("""{"status":"ok","draft":{"vehicle_id":"7","signals":[],"range_preset":"24h","per_page":50}}"""),
            ),
        )
    }

    @Test
    fun nonArraySignalsIsRejected() {
        assertNull(
            parseSignalFilterDraft(
                json("""{"status":"ok","draft":{"vehicle_id":7,"signals":"battery_level","range_preset":"24h","per_page":50}}"""),
            ),
        )
    }

    @Test
    fun missingOrNonStringRangePresetIsRejected() {
        assertNull(parseSignalFilterDraft(json("""{"status":"ok","draft":{"vehicle_id":7,"signals":[],"per_page":50}}""")))
        assertNull(
            parseSignalFilterDraft(
                json("""{"status":"ok","draft":{"vehicle_id":7,"signals":[],"range_preset":5,"per_page":50}}"""),
            ),
        )
    }

    @Test
    fun missingOrNonNumberPerPageIsRejected() {
        assertNull(parseSignalFilterDraft(json("""{"status":"ok","draft":{"vehicle_id":7,"signals":[],"range_preset":"24h"}}""")))
        assertNull(
            parseSignalFilterDraft(
                json("""{"status":"ok","draft":{"vehicle_id":7,"signals":[],"range_preset":"24h","per_page":"50"}}"""),
            ),
        )
    }

    // ── reducer ─────────────────────────────────────────────────────────────────────
    @Test
    fun withPromptUpdatesPrompt() {
        assertEquals("hi", AiFilterDraftState().withPrompt("hi").prompt)
    }

    @Test
    fun withVehicleUpdatesVehicle() {
        assertEquals(9L, AiFilterDraftState().withVehicle(9L).vehicleId)
        assertNull(AiFilterDraftState(vehicleId = 9L).withVehicle(null).vehicleId)
    }

    @Test
    fun startDraftingEntersStreamingAndClearsTransientsAndDraft() {
        val next =
            AiFilterDraftState(
                streamingText = "old",
                errorKind = ErrorKind.Http,
                draft = SignalFilterDraft(1L, listOf("s"), "24h", 50),
                committedText = "kept",
            ).startDrafting()
        assertEquals(DraftPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertNull(next.draft)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiFilterDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("bat"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("tery"), nowMs = 2L)
        assertEquals("battery", next.streamingText)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun draftCapturedStoresDraftWithoutEndingStream() {
        val draft = SignalFilterDraft(7L, listOf("battery_level"), "yesterday", 100)
        val next =
            AiFilterDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.DraftCaptured(draft), nowMs = 1L)
        assertEquals(draft, next.draft)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiFilterDraftState(phase = DraftPhase.Streaming, streamingText = "done draft")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(DraftPhase.Done, next.phase)
        assertEquals("done draft", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiFilterDraftState(phase = DraftPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(DraftPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommittedAndDraft() {
        val draft = SignalFilterDraft(1L, listOf("s"), "24h", 50)
        val next =
            AiFilterDraftState(phase = DraftPhase.Streaming, committedText = "prev", draft = draft)
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DraftPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
        assertEquals(draft, next.draft)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiFilterDraftState(phase = DraftPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DraftPhase.Done, promoted.phase)
        val untouched = AiFilterDraftState(phase = DraftPhase.Failed).finishIfStreaming(9L)
        assertEquals(DraftPhase.Failed, untouched.phase)
    }

    // ── derived state ────────────────────────────────────────────────────────────────
    @Test
    fun hasPromptAndHasVehicleGateCanStart() {
        // canStart needs BOTH a non-blank prompt AND a positive vehicle id (web `hasPrompt && hasVehicle`).
        assertFalse(AiFilterDraftState(prompt = "  q  ").canStart)
        assertFalse(AiFilterDraftState(prompt = "  q  ", vehicleId = 0L).canStart)
        assertFalse(AiFilterDraftState(prompt = "   ", vehicleId = 5L).canStart)
        assertTrue(AiFilterDraftState(prompt = "  q  ", vehicleId = 5L).canStart)
        assertEquals("q", AiFilterDraftState(prompt = "  q  ").trimmedPrompt)
    }

    @Test
    fun canApplyRequiresDraftAndNotStreaming() {
        val draft = SignalFilterDraft(1L, listOf("s"), "24h", 50)
        assertTrue(AiFilterDraftState(phase = DraftPhase.Done, draft = draft).canApply)
        assertFalse(AiFilterDraftState(phase = DraftPhase.Streaming, draft = draft).canApply)
        assertFalse(AiFilterDraftState(phase = DraftPhase.Done, draft = null).canApply)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        assertEquals(
            FilterDraftSurface.Hidden,
            classifyDraft(AiFilterDraftState(gateEnabled = false, prompt = "q", vehicleId = 1L), nowMs = 0L),
        )
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            FilterDraftSurface.Resting(canStart = true),
            classifyDraft(AiFilterDraftState(prompt = "q", vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            FilterDraftSurface.Resting(canStart = false),
            classifyDraft(AiFilterDraftState(prompt = "q", vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        assertEquals(
            FilterDraftSurface.Working,
            classifyDraft(AiFilterDraftState(prompt = "q", vehicleId = 1L, phase = DraftPhase.Streaming), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithTextIsLive() {
        assertEquals(
            FilterDraftSurface.Live("partial"),
            classifyDraft(
                AiFilterDraftState(prompt = "q", vehicleId = 1L, phase = DraftPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        assertEquals(
            FilterDraftSurface.Ready("draft", stale = false),
            classifyDraft(
                AiFilterDraftState(prompt = "q", phase = DraftPhase.Done, committedText = "draft", fetchedAt = 1_000L),
                nowMs = 1_000L + window - 1L,
            ),
        )
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        assertEquals(
            FilterDraftSurface.Ready("draft", stale = true),
            classifyDraft(
                AiFilterDraftState(prompt = "q", phase = DraftPhase.Done, committedText = "draft", fetchedAt = 1_000L),
                nowMs = 1_000L + window + 1L,
            ),
        )
    }

    @Test
    fun doneBlankIsEmpty() {
        assertEquals(
            FilterDraftSurface.Empty,
            classifyDraft(AiFilterDraftState(prompt = "q", phase = DraftPhase.Done, committedText = ""), nowMs = 0L),
        )
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        assertEquals(
            FilterDraftSurface.Cached("last", offline = true),
            classifyDraft(
                AiFilterDraftState(
                    prompt = "q",
                    phase = DraftPhase.Failed,
                    committedText = "last",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        assertEquals(
            FilterDraftSurface.Cached("last", offline = false),
            classifyDraft(
                AiFilterDraftState(
                    prompt = "q",
                    phase = DraftPhase.Failed,
                    committedText = "last",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        assertEquals(
            FilterDraftSurface.Failed(offline = true),
            classifyDraft(
                AiFilterDraftState(prompt = "q", phase = DraftPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        assertEquals(
            FilterDraftSurface.Failed(offline = false),
            classifyDraft(
                AiFilterDraftState(prompt = "q", phase = DraftPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            ),
        )
    }

    // ── freshness ───────────────────────────────────────────────────────────────────
    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── i18n facade ──────────────────────────────────────────────────────────────────
    @Test
    fun foldCatalogKeyMatchesGeneratorNaming() {
        assertEquals("translation_signalExplorer_aiFilter_title", foldCatalogKey("signalExplorer.aiFilter.title"))
        assertEquals("translation_signal_explorer_nl_filter", foldCatalogKey("signal-explorer-nl-filter"))
    }

    @Test
    fun fallbackResolverPaintsWebEnglish() {
        val labels = aiFilterLabels(FallbackResolver)
        assertEquals("Helix natural-language filter", labels.title)
        assertEquals("Draft filter", labels.button)
        assertEquals("Helix", labels.badge)
        assertEquals("Filter request", labels.promptLabel)
        assertEquals("e.g. show me battery level for yesterday", labels.promptHint)
        assertEquals("Apply to filters", labels.applyButton)
        assertEquals(
            "Copy the proposed filter into the form above. You can still edit it before clicking Explore.",
            labels.applyTooltip,
        )
    }

    @Test
    fun resolverIsConsultedByFoldedKey() {
        val resolve: StringResolver = { key, fallback -> if (key == AiFilterKeys.BUTTON) "Borrador de filtro" else fallback }
        assertEquals("Borrador de filtro", aiFilterLabels(resolve).button)
        assertEquals("Helix natural-language filter", aiFilterLabels(resolve).title)
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────
    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        assertEquals(
            "Helix filter (Helix). Describe a filter.",
            headerAccessibilityLabel("Helix filter", "Helix", "Describe a filter."),
        )
    }

    @Test
    fun draftButtonContentDescriptionCarriesContextualVerb() {
        assertEquals("Ask Helix \u00b7 Draft filter", draftButtonContentDescription("Ask Helix", "Draft filter"))
    }

    @Test
    fun applyButtonContentDescriptionFoldsTooltip() {
        assertEquals(
            "Apply to filters. Copy the proposed filter into the form above.",
            applyButtonContentDescription("Apply to filters", "Copy the proposed filter into the form above."),
        )
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            FilterDraftOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Helix couldn't draft the filter. Please try again.",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(FilterDraftSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(FilterDraftSurface.Live("p"), labels))
        assertEquals("draft", outputAccessibilityLabel(FilterDraftSurface.Ready("draft", stale = false), labels))
        assertEquals("Stale. draft", outputAccessibilityLabel(FilterDraftSurface.Ready("draft", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(FilterDraftSurface.Empty, labels))
        assertEquals("Offline. draft", outputAccessibilityLabel(FilterDraftSurface.Cached("draft", offline = true), labels))
        assertEquals(
            "Helix couldn't draft the filter. Please try again. draft",
            outputAccessibilityLabel(FilterDraftSurface.Cached("draft", offline = false), labels),
        )
        assertEquals(
            "Helix couldn't draft the filter. Please try again.",
            outputAccessibilityLabel(FilterDraftSurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = FilterDraftOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(FilterDraftSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(FilterDraftSurface.Hidden, labels))
    }

    // ── registration constants ───────────────────────────────────────────────────────
    @Test
    fun registrationConstantsMatchWebContract() {
        assertEquals("AISignalExplorerNlFilter", AI_SIGNAL_EXPLORER_NL_FILTER_SLUG)
        assertEquals("signal-explorer-nl-filter", SIGNAL_EXPLORER_NL_FILTER_FEATURE_ID)
        assertEquals("draft_signal_filter", DRAFT_TOOL_NAME)
    }
}
