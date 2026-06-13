// Off-device unit tests for the pure AIPredictiveMaintenance model: the stream reducer, the surface classifier
// (every loading / empty / content / error / stale / offline branch the web component resolves), the freshness
// rule, the `vehicleId > 0` scope gate (web `haveScope`), and the accessibility-label builders (TalkBack-label
// presence, including the "select a vehicle" hint branch). Run by the offline :android:testReleaseUnitTest
// gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aipredictivemaintenance

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIPredictiveMaintenanceModelTest {
    private val window = MAINTENANCE_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiMaintenanceState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(MaintenancePhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiMaintenanceState(phase = MaintenancePhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(MaintenancePhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiMaintenanceState(phase = MaintenancePhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(MaintenancePhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiMaintenanceState(phase = MaintenancePhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(MaintenancePhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiMaintenanceState(phase = MaintenancePhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(MaintenancePhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiMaintenanceState(phase = MaintenancePhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(MaintenancePhase.Done, promoted.phase)
        val untouched = AiMaintenanceState(phase = MaintenancePhase.Failed).finishIfStreaming(9L)
        assertEquals(MaintenancePhase.Failed, untouched.phase)
    }

    // ── canStart parity with web haveScope (number && finite && > 0) ─────────────────
    @Test
    fun canStartMirrorsPositiveVehicleId() {
        assertTrue(AiMaintenanceState(vehicleId = 1L).canStart)
        assertTrue(AiMaintenanceState(vehicleId = 4823L).canStart)
        assertFalse(AiMaintenanceState(vehicleId = null).canStart)
        assertFalse(AiMaintenanceState(vehicleId = 0L).canStart)
        assertFalse(AiMaintenanceState(vehicleId = -5L).canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyMaintenance(AiMaintenanceState(gateEnabled = false, vehicleId = 1L), nowMs = 0L)
        assertEquals(MaintenanceSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            MaintenanceSurface.Resting(canStart = true),
            classifyMaintenance(AiMaintenanceState(vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            MaintenanceSurface.Resting(canStart = false),
            classifyMaintenance(AiMaintenanceState(vehicleId = null), nowMs = 0L),
        )
        assertEquals(
            MaintenanceSurface.Resting(canStart = false),
            classifyMaintenance(AiMaintenanceState(vehicleId = 0L), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyMaintenance(AiMaintenanceState(vehicleId = 1L, phase = MaintenancePhase.Streaming), nowMs = 0L)
        assertEquals(MaintenanceSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(vehicleId = 1L, phase = MaintenancePhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(MaintenanceSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(
                    vehicleId = 1L,
                    phase = MaintenancePhase.Done,
                    committedText = "predicted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(MaintenanceSurface.Ready("predicted", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(
                    vehicleId = 1L,
                    phase = MaintenancePhase.Done,
                    committedText = "predicted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(MaintenanceSurface.Ready("predicted", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(vehicleId = 1L, phase = MaintenancePhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(MaintenanceSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(
                    vehicleId = 1L,
                    phase = MaintenancePhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(MaintenanceSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(
                    vehicleId = 1L,
                    phase = MaintenancePhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(MaintenanceSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(vehicleId = 1L, phase = MaintenancePhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(MaintenanceSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyMaintenance(
                AiMaintenanceState(vehicleId = 1L, phase = MaintenancePhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(MaintenanceSurface.Failed(offline = false), surface)
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
            headerAccessibilityLabel("Helix maintenance advisor", "Helix", "Get a factual maintenance narrative.")
        assertEquals("Helix maintenance advisor (Helix). Get a factual maintenance narrative.", label)
    }

    @Test
    fun headerLabelAppendsHintWhenScopeMissing() {
        val label =
            headerAccessibilityLabel(
                "Helix maintenance advisor",
                "Helix",
                "Get a factual maintenance narrative.",
                hint = "Select a vehicle first.",
            )
        assertEquals(
            "Helix maintenance advisor (Helix). Get a factual maintenance narrative. Select a vehicle first.",
            label,
        )
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            MaintenanceOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(MaintenanceSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(MaintenanceSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(MaintenanceSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(MaintenanceSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(MaintenanceSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(MaintenanceSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(MaintenanceSurface.Cached("cached", offline = false), labels),
        )
        assertEquals(
            "Failed to load data",
            outputAccessibilityLabel(MaintenanceSurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = MaintenanceOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(MaintenanceSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(MaintenanceSurface.Hidden, labels))
    }
}
