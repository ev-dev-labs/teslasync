// Off-device unit tests for the pure AISoftwareUpdateChangelogSummarizer model: the stream reducer, the surface
// classifier (every loading / empty / content / error / stale / offline branch the web component resolves), the
// freshness rule, and the accessibility-label builders (TalkBack-label presence, including the no-vehicle hint).
// Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisoftwareupdatechangelogsummarizer

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AISoftwareUpdateChangelogSummarizerModelTest {
    private val window = CHANGELOG_SUMMARY_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            ChangelogSummaryState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(SummaryPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            ChangelogSummaryState(phase = SummaryPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(SummaryPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            ChangelogSummaryState(phase = SummaryPhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(SummaryPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            ChangelogSummaryState(phase = SummaryPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(SummaryPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            ChangelogSummaryState(phase = SummaryPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(SummaryPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = ChangelogSummaryState(phase = SummaryPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(SummaryPhase.Done, promoted.phase)
        val untouched = ChangelogSummaryState(phase = SummaryPhase.Failed).finishIfStreaming(9L)
        assertEquals(SummaryPhase.Failed, untouched.phase)
    }

    // ── canStart (web haveInputs = numericVehicleId > 0) ───────────────────────────
    @Test
    fun canStartRequiresAPositiveVehicleId() {
        assertTrue(ChangelogSummaryState(vehicleId = 1L).canStart)
        assertFalse(ChangelogSummaryState(vehicleId = null).canStart)
        assertFalse(ChangelogSummaryState(vehicleId = 0L).canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifySummary(ChangelogSummaryState(gateEnabled = false, vehicleId = 1L), nowMs = 0L)
        assertEquals(SummarySurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            SummarySurface.Resting(canStart = true),
            classifySummary(ChangelogSummaryState(vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            SummarySurface.Resting(canStart = false),
            classifySummary(ChangelogSummaryState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifySummary(ChangelogSummaryState(vehicleId = 1L, phase = SummaryPhase.Streaming), nowMs = 0L)
        assertEquals(SummarySurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifySummary(
                ChangelogSummaryState(vehicleId = 1L, phase = SummaryPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifySummary(
                ChangelogSummaryState(
                    vehicleId = 1L,
                    phase = SummaryPhase.Done,
                    committedText = "summary",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(SummarySurface.Ready("summary", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifySummary(
                ChangelogSummaryState(
                    vehicleId = 1L,
                    phase = SummaryPhase.Done,
                    committedText = "summary",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(SummarySurface.Ready("summary", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifySummary(
                ChangelogSummaryState(vehicleId = 1L, phase = SummaryPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifySummary(
                ChangelogSummaryState(
                    vehicleId = 1L,
                    phase = SummaryPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifySummary(
                ChangelogSummaryState(
                    vehicleId = 1L,
                    phase = SummaryPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifySummary(
                ChangelogSummaryState(vehicleId = 1L, phase = SummaryPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifySummary(
                ChangelogSummaryState(vehicleId = 1L, phase = SummaryPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Failed(offline = false), surface)
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
                "Summarize my software update history",
                "Helix",
                "Ask Helix to walk through your firmware update history.",
            )
        assertEquals(
            "Summarize my software update history (Helix). Ask Helix to walk through your firmware update history.",
            label,
        )
    }

    @Test
    fun headerLabelAppendsNoVehicleHintWhenPresent() {
        val label =
            headerAccessibilityLabel(
                "Summarize my software update history",
                "Helix",
                "Ask Helix to walk through your firmware update history.",
                noVehicleHint = "Pick a vehicle above to enable Helix.",
            )
        assertEquals(
            "Summarize my software update history (Helix). Ask Helix to walk through your firmware update " +
                "history. Pick a vehicle above to enable Helix.",
            label,
        )
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            SummaryOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(SummarySurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(SummarySurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(SummarySurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(SummarySurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(SummarySurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(SummarySurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(SummarySurface.Cached("cached", offline = false), labels),
        )
        assertEquals(
            "Failed to load data",
            outputAccessibilityLabel(SummarySurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = SummaryOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(SummarySurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(SummarySurface.Hidden, labels))
    }
}
