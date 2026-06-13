// Off-device unit tests for the pure AIPreheatPrecoolRecommender model: the deterministic inputs -> request
// body projection (the "adapter" projection the prompt requires), the four-input canStart parity, the stream
// reducer, the surface classifier (every loading / empty / content / error / stale / offline branch the web
// component resolves), the freshness rule, and the accessibility-label builders (TalkBack-label presence).
// Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aipreheatprecoolrecommender

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIPreheatPrecoolRecommenderModelTest {
    private val window = DRAFT_FRESHNESS_WINDOW_MS

    private fun completeInputs(
        vehicleId: Long = 1023L,
        departBy: String = DEPART,
        cabin: Double = 8.0,
        outside: Double = 4.0,
        target: Double? = 21.0,
    ): PreheatDraftInputs =
        PreheatDraftInputs(
            vehicleId = vehicleId,
            departBy = departBy,
            currentCabinTempC = cabin,
            outsideTempC = outside,
            targetCabinTempC = target,
        )

    // ── inputs -> request body projection (adapter projection) ──────────────────────
    @Test
    fun toRequestBodyPassesResolvedInputsThrough() {
        val body = completeInputs().toRequestBody()
        assertEquals(1023L, body.vehicleId)
        assertEquals(DEPART, body.departBy)
        assertEquals(8.0, body.currentCabinTempC, 0.0)
        assertEquals(4.0, body.outsideTempC, 0.0)
        assertEquals(21.0, body.targetCabinTempC, 0.0)
    }

    @Test
    fun toRequestBodyDefaultsTargetWhenAbsent() {
        val body = completeInputs(target = null).toRequestBody()
        assertEquals(DEFAULT_TARGET_CABIN_TEMP_C, body.targetCabinTempC, 0.0)
    }

    @Test
    fun toRequestBodyDefaultsTargetWhenNonFinite() {
        val body = completeInputs(target = Double.NaN).toRequestBody()
        assertEquals(DEFAULT_TARGET_CABIN_TEMP_C, body.targetCabinTempC, 0.0)
    }

    @Test
    fun toRequestBodyCoercesAbsentScalarsToZeroAndEmpty() {
        val body = PreheatDraftInputs().toRequestBody()
        assertEquals(0L, body.vehicleId)
        assertEquals("", body.departBy)
        assertEquals(0.0, body.currentCabinTempC, 0.0)
        assertEquals(0.0, body.outsideTempC, 0.0)
        assertEquals(DEFAULT_TARGET_CABIN_TEMP_C, body.targetCabinTempC, 0.0)
    }

    @Test
    fun toRequestBodyCoercesNonFiniteTemperaturesToZero() {
        val body =
            PreheatDraftInputs(
                vehicleId = 7L,
                departBy = DEPART,
                currentCabinTempC = Double.POSITIVE_INFINITY,
                outsideTempC = Double.NaN,
            ).toRequestBody()
        assertEquals(0.0, body.currentCabinTempC, 0.0)
        assertEquals(0.0, body.outsideTempC, 0.0)
    }

    // ── canStart parity with web `haveVehicle && haveDepart && haveCabin && haveOutside` ──
    @Test
    fun canStartRequiresEveryInput() {
        assertTrue(completeInputs().canStart)
    }

    @Test
    fun canStartFalseWithoutPositiveVehicle() {
        assertFalse(completeInputs(vehicleId = 0L).canStart)
        assertFalse(completeInputs().copy(vehicleId = null).canStart)
        assertFalse(completeInputs(vehicleId = -3L).canStart)
    }

    @Test
    fun canStartFalseWithoutDepart() {
        assertFalse(completeInputs(departBy = "").canStart)
        assertFalse(completeInputs().copy(departBy = null).canStart)
    }

    @Test
    fun canStartFalseWithoutFiniteCabin() {
        assertFalse(completeInputs().copy(currentCabinTempC = null).canStart)
        assertFalse(completeInputs(cabin = Double.NaN).canStart)
    }

    @Test
    fun canStartFalseWithoutFiniteOutside() {
        assertFalse(completeInputs().copy(outsideTempC = null).canStart)
        assertFalse(completeInputs(outside = Double.POSITIVE_INFINITY).canStart)
    }

    @Test
    fun canStartIgnoresTargetTemperature() {
        assertTrue(completeInputs(target = null).canStart)
        assertTrue(completeInputs(target = Double.NaN).canStart)
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            PreheatDraftState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(DraftPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            PreheatDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Pre"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("heat"), nowMs = 2L)
        assertEquals("Preheat", next.streamingText)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            PreheatDraftState(phase = DraftPhase.Streaming, streamingText = "draft text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(DraftPhase.Done, next.phase)
        assertEquals("draft text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            PreheatDraftState(phase = DraftPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(DraftPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            PreheatDraftState(phase = DraftPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DraftPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = PreheatDraftState(phase = DraftPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DraftPhase.Done, promoted.phase)
        val untouched = PreheatDraftState(phase = DraftPhase.Failed).finishIfStreaming(9L)
        assertEquals(DraftPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyDraft(PreheatDraftState(gateEnabled = false, inputs = completeInputs()), nowMs = 0L)
        assertEquals(DraftSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            DraftSurface.Resting(canStart = true),
            classifyDraft(PreheatDraftState(inputs = completeInputs()), nowMs = 0L),
        )
        assertEquals(
            DraftSurface.Resting(canStart = false),
            classifyDraft(PreheatDraftState(inputs = PreheatDraftInputs(vehicleId = 1023L)), nowMs = 0L),
        )
        assertEquals(
            DraftSurface.Resting(canStart = false),
            classifyDraft(PreheatDraftState(inputs = PreheatDraftInputs()), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyDraft(PreheatDraftState(inputs = completeInputs(), phase = DraftPhase.Streaming), nowMs = 0L)
        assertEquals(DraftSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyDraft(
                PreheatDraftState(inputs = completeInputs(), phase = DraftPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyDraft(
                PreheatDraftState(
                    inputs = completeInputs(),
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
                PreheatDraftState(
                    inputs = completeInputs(),
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
                PreheatDraftState(inputs = completeInputs(), phase = DraftPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyDraft(
                PreheatDraftState(
                    inputs = completeInputs(),
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
                PreheatDraftState(
                    inputs = completeInputs(),
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
                PreheatDraftState(inputs = completeInputs(), phase = DraftPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyDraft(
                PreheatDraftState(inputs = completeInputs(), phase = DraftPhase.Failed, errorKind = ErrorKind.Http),
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
        val label = headerAccessibilityLabel("Suggest a preheat or precool schedule", "Helix", "Ask Helix to draft.")
        assertEquals("Suggest a preheat or precool schedule (Helix). Ask Helix to draft.", label)
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

    private companion object {
        const val DEPART = "2026-06-13T07:30:00Z"
    }
}
