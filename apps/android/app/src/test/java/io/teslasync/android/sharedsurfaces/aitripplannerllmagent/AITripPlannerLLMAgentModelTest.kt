// Off-device unit tests for the pure AITripPlannerLLMAgent model: the request-body builder (web `useMemo` body
// defaults + fallbacks), the three-input canStart parity, the stream reducer, the surface classifier (every
// loading / empty / content / error / stale / offline branch the web component resolves), the freshness rule,
// and the accessibility-label builders (TalkBack-label presence). This is the adapter/per-state projection test
// required by the acceptance gate — it deterministically asserts the render-ready surface for every state
// without a Compose host. Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android
// framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aitripplannerllmagent

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AITripPlannerLLMAgentModelTest {
    private val window = TRIP_PLAN_FRESHNESS_WINDOW_MS
    private val origin = TripLocation(37.4419, -122.1430, "Palo Alto")
    private val destination = TripLocation(34.0522, -118.2437, "Los Angeles")
    private val complete = TripPlanInputs(vehicleId = 7L, origin = origin, destination = destination)

    // ── request body builder (web useMemo body) ─────────────────────────────────────
    @Test
    fun toDraftRequestAppliesWebDefaultsForUnsetEnvelope() {
        val request = complete.toDraftRequest()
        assertEquals(
            TripPlanDraftRequest(
                vehicleId = 7L,
                origin = origin,
                destination = destination,
                currentSoc = DEFAULT_CURRENT_SOC,
                chargeLimitSoc = DEFAULT_CHARGE_LIMIT_SOC,
                minArrivalSoc = DEFAULT_MIN_ARRIVAL_SOC,
                speedFactor = DEFAULT_SPEED_FACTOR,
            ),
            request,
        )
    }

    @Test
    fun toDraftRequestPreservesProvidedEnvelope() {
        val request =
            TripPlanInputs(
                vehicleId = 12L,
                origin = origin,
                destination = destination,
                currentSoc = 64.0,
                chargeLimitSoc = 80.0,
                minArrivalSoc = 15.0,
                speedFactor = 1.1,
            ).toDraftRequest()
        assertEquals(64.0, request.currentSoc, 0.0)
        assertEquals(80.0, request.chargeLimitSoc, 0.0)
        assertEquals(15.0, request.minArrivalSoc, 0.0)
        assertEquals(1.1, request.speedFactor, 0.0)
    }

    @Test
    fun toDraftRequestFallsBackVehicleAndCorridorWhenNull() {
        val request = TripPlanInputs().toDraftRequest()
        assertEquals(0L, request.vehicleId)
        assertEquals(TripLocation(0.0, 0.0, ""), request.origin)
        assertEquals(TripLocation(0.0, 0.0, ""), request.destination)
        assertEquals(DEFAULT_CURRENT_SOC, request.currentSoc, 0.0)
        assertEquals(DEFAULT_SPEED_FACTOR, request.speedFactor, 0.0)
    }

    @Test
    fun tripLocationNameDefaultsToEmpty() {
        assertEquals("", TripLocation(1.0, 2.0).name)
    }

    // ── canStart parity with web !!vehicleId && origin && destination ────────────────
    @Test
    fun canStartRequiresVehicleOriginAndDestination() {
        assertTrue(complete.canStart)
        assertFalse(complete.copy(vehicleId = null).canStart)
        assertFalse(complete.copy(origin = null).canStart)
        assertFalse(complete.copy(destination = null).canStart)
    }

    @Test
    fun canStartTreatsZeroVehicleAsAbsent() {
        assertFalse(complete.copy(vehicleId = 0L).canStart)
    }

    @Test
    fun stateCanStartDelegatesToInputs() {
        assertTrue(TripPlanState(inputs = complete).canStart)
        assertFalse(TripPlanState(inputs = TripPlanInputs(vehicleId = 7L)).canStart)
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            TripPlanState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept").startGenerating()
        assertEquals(TripPlanPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            TripPlanState(phase = TripPlanPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(TripPlanPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            TripPlanState(phase = TripPlanPhase.Streaming, streamingText = "draft text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(TripPlanPhase.Done, next.phase)
        assertEquals("draft text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            TripPlanState(phase = TripPlanPhase.Streaming, streamingText = "   ").onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(TripPlanPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            TripPlanState(phase = TripPlanPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(TripPlanPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = TripPlanState(phase = TripPlanPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(TripPlanPhase.Done, promoted.phase)
        val untouched = TripPlanState(phase = TripPlanPhase.Failed).finishIfStreaming(9L)
        assertEquals(TripPlanPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyTripPlan(TripPlanState(gateEnabled = false, inputs = complete), nowMs = 0L)
        assertEquals(TripPlanSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            TripPlanSurface.Resting(canStart = true),
            classifyTripPlan(TripPlanState(inputs = complete), nowMs = 0L),
        )
        assertEquals(
            TripPlanSurface.Resting(canStart = false),
            classifyTripPlan(TripPlanState(inputs = TripPlanInputs()), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyTripPlan(TripPlanState(inputs = complete, phase = TripPlanPhase.Streaming), nowMs = 0L)
        assertEquals(TripPlanSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyTripPlan(
                TripPlanState(inputs = complete, phase = TripPlanPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(TripPlanSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyTripPlan(
                TripPlanState(
                    inputs = complete,
                    phase = TripPlanPhase.Done,
                    committedText = "plan",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(TripPlanSurface.Ready("plan", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyTripPlan(
                TripPlanState(
                    inputs = complete,
                    phase = TripPlanPhase.Done,
                    committedText = "plan",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(TripPlanSurface.Ready("plan", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyTripPlan(
                TripPlanState(inputs = complete, phase = TripPlanPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(TripPlanSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyTripPlan(
                TripPlanState(
                    inputs = complete,
                    phase = TripPlanPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(TripPlanSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyTripPlan(
                TripPlanState(
                    inputs = complete,
                    phase = TripPlanPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(TripPlanSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyTripPlan(
                TripPlanState(inputs = complete, phase = TripPlanPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(TripPlanSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyTripPlan(
                TripPlanState(inputs = complete, phase = TripPlanPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(TripPlanSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Draft a plan with Helix", "Helix", "Ask Helix to draft a trip plan.")
        assertEquals("Draft a plan with Helix (Helix). Ask Helix to draft a trip plan.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            TripPlanOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(TripPlanSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(TripPlanSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(TripPlanSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(TripPlanSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(TripPlanSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(TripPlanSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(TripPlanSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(TripPlanSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = TripPlanOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(TripPlanSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(TripPlanSurface.Hidden, labels))
    }
}
