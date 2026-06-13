// Off-device unit tests for the pure AIMLChargingCurveClustering model: the stream reducer, the surface
// classifier (every loading / empty / content / error / stale / offline branch the web component resolves),
// the freshness rule, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :app:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIMLChargingCurveClustering) cannot form a valid Kotlin package, so the
// package intentionally diverges from the path — exactly as the production sources and the sibling
// AIChargingCurveFingerprintClustering tests do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimlchargingcurveclustering

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIMLChargingCurveClusteringModelTest {
    private val window = CLUSTERING_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            MlClusteringState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(ClusterStreamPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            MlClusteringState(phase = ClusterStreamPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(ClusterStreamPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            MlClusteringState(phase = ClusterStreamPhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(ClusterStreamPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            MlClusteringState(phase = ClusterStreamPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(ClusterStreamPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            MlClusteringState(phase = ClusterStreamPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(ClusterStreamPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = MlClusteringState(phase = ClusterStreamPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(ClusterStreamPhase.Done, promoted.phase)
        val untouched = MlClusteringState(phase = ClusterStreamPhase.Failed).finishIfStreaming(9L)
        assertEquals(ClusterStreamPhase.Failed, untouched.phase)
    }

    // ── canStart parity with web `vehicleId != null` ────────────────────────────────
    @Test
    fun canStartMirrorsVehiclePresence() {
        assertTrue(MlClusteringState(vehicleId = 1023L).canStart)
        assertFalse(MlClusteringState(vehicleId = null).canStart)
    }

    // ── lookback default parity with web `lookback_days: 90` ─────────────────────────
    @Test
    fun defaultLookbackMatchesWebBody() {
        assertEquals(90, DEFAULT_LOOKBACK_DAYS)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyClustering(MlClusteringState(gateEnabled = false, vehicleId = 1023L), nowMs = 0L)
        assertEquals(ClusteringSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            ClusteringSurface.Resting(canStart = true),
            classifyClustering(MlClusteringState(vehicleId = 1023L), nowMs = 0L),
        )
        assertEquals(
            ClusteringSurface.Resting(canStart = false),
            classifyClustering(MlClusteringState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyClustering(MlClusteringState(vehicleId = 1023L, phase = ClusterStreamPhase.Streaming), nowMs = 0L)
        assertEquals(ClusteringSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyClustering(
                MlClusteringState(vehicleId = 1023L, phase = ClusterStreamPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(ClusteringSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyClustering(
                MlClusteringState(
                    vehicleId = 1023L,
                    phase = ClusterStreamPhase.Done,
                    committedText = "clustered",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(ClusteringSurface.Ready("clustered", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyClustering(
                MlClusteringState(
                    vehicleId = 1023L,
                    phase = ClusterStreamPhase.Done,
                    committedText = "clustered",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(ClusteringSurface.Ready("clustered", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyClustering(
                MlClusteringState(vehicleId = 1023L, phase = ClusterStreamPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(ClusteringSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyClustering(
                MlClusteringState(
                    vehicleId = 1023L,
                    phase = ClusterStreamPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(ClusteringSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyClustering(
                MlClusteringState(
                    vehicleId = 1023L,
                    phase = ClusterStreamPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(ClusteringSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyClustering(
                MlClusteringState(vehicleId = 1023L, phase = ClusterStreamPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(ClusteringSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyClustering(
                MlClusteringState(vehicleId = 1023L, phase = ClusterStreamPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(ClusteringSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Learn charging-curve clusters", "Helix", "Train per-vehicle clusters.")
        assertEquals("Learn charging-curve clusters (Helix). Train per-vehicle clusters.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            ClusteringOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(ClusteringSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(ClusteringSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(ClusteringSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(ClusteringSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(ClusteringSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(ClusteringSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(ClusteringSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(ClusteringSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = ClusteringOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(ClusteringSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(ClusteringSurface.Hidden, labels))
    }
}
