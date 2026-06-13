// Off-device unit tests for the pure AILogTraceSummarization model: the log-window guard, the vehicle-id
// normalization, the stream reducer, the surface classifier (every loading / empty / content / error / stale /
// offline branch the web component resolves), the freshness rule, and the accessibility-label builders
// (TalkBack-label presence). Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android
// framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailogtracesummarization

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AILogTraceSummarizationModelTest {
    private val window = SUMMARY_FRESHNESS_WINDOW_MS

    // ── log-window guard ─────────────────────────────────────────────────────────────
    @Test
    fun windowAcceptableRequiresBothBounds() {
        assertFalse(windowAcceptable(null, null))
        assertFalse(windowAcceptable(FROM, null))
        assertFalse(windowAcceptable(null, TO))
    }

    @Test
    fun windowAcceptableRequiresPositiveStartAndIncreasingEnd() {
        assertFalse(windowAcceptable(0L, TO))
        assertFalse(windowAcceptable(-10L, TO))
        assertFalse(windowAcceptable(FROM, FROM))
        assertFalse(windowAcceptable(FROM, FROM - 1L))
    }

    @Test
    fun windowAcceptableCapsAtTwentyFourHours() {
        assertTrue(windowAcceptable(FROM, FROM + MAX_LOG_WINDOW_SECONDS))
        assertFalse(windowAcceptable(FROM, FROM + MAX_LOG_WINDOW_SECONDS + 1L))
    }

    @Test
    fun windowAcceptableAcceptsValidBoundedWindow() {
        assertTrue(windowAcceptable(FROM, TO))
        assertTrue(AiSummaryState(fromUnix = FROM, toUnix = TO).canStart)
        assertFalse(AiSummaryState(fromUnix = null, toUnix = null).canStart)
    }

    @Test
    fun acceptableWindowLiftsBoundsOnlyWhenValid() {
        assertEquals(FROM to TO, AiSummaryState(fromUnix = FROM, toUnix = TO).acceptableWindow())
        assertNull(AiSummaryState(fromUnix = null, toUnix = TO).acceptableWindow())
        assertNull(AiSummaryState(fromUnix = FROM, toUnix = FROM).acceptableWindow())
        assertNull(
            AiSummaryState(fromUnix = FROM, toUnix = FROM + MAX_LOG_WINDOW_SECONDS + 1L).acceptableWindow(),
        )
    }

    // ── vehicle-id normalization ───────────────────────────────────────────────────────
    @Test
    fun normalizeVehicleIdDropsNonPositiveAndNull() {
        assertNull(normalizeVehicleId(null))
        assertNull(normalizeVehicleId(0L))
        assertNull(normalizeVehicleId(-4L))
        assertEquals(7L, normalizeVehicleId(7L))
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            AiSummaryState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(SummaryPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiSummaryState(phase = SummaryPhase.Streaming)
                .onChunk(AiSummaryChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiSummaryChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(SummaryPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiSummaryState(phase = SummaryPhase.Streaming, streamingText = "done text")
                .onChunk(AiSummaryChunk.Done, nowMs = 42L)
        assertEquals(SummaryPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiSummaryState(phase = SummaryPhase.Streaming, streamingText = "   ")
                .onChunk(AiSummaryChunk.Done, nowMs = 7L)
        assertEquals(SummaryPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiSummaryState(phase = SummaryPhase.Streaming, committedText = "prev")
                .onChunk(AiSummaryChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(SummaryPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiSummaryState(phase = SummaryPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(SummaryPhase.Done, promoted.phase)
        val untouched = AiSummaryState(phase = SummaryPhase.Failed).finishIfStreaming(9L)
        assertEquals(SummaryPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifySummary(AiSummaryState(gateEnabled = false, fromUnix = FROM, toUnix = TO), nowMs = 0L)
        assertEquals(SummarySurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            SummarySurface.Resting(canStart = true),
            classifySummary(AiSummaryState(fromUnix = FROM, toUnix = TO), nowMs = 0L),
        )
        assertEquals(
            SummarySurface.Resting(canStart = false),
            classifySummary(AiSummaryState(fromUnix = null, toUnix = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifySummary(AiSummaryState(fromUnix = FROM, toUnix = TO, phase = SummaryPhase.Streaming), nowMs = 0L)
        assertEquals(SummarySurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifySummary(
                AiSummaryState(fromUnix = FROM, toUnix = TO, phase = SummaryPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifySummary(
                AiSummaryState(
                    fromUnix = FROM,
                    toUnix = TO,
                    phase = SummaryPhase.Done,
                    committedText = "summarized",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(SummarySurface.Ready("summarized", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifySummary(
                AiSummaryState(
                    fromUnix = FROM,
                    toUnix = TO,
                    phase = SummaryPhase.Done,
                    committedText = "summarized",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(SummarySurface.Ready("summarized", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifySummary(
                AiSummaryState(fromUnix = FROM, toUnix = TO, phase = SummaryPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifySummary(
                AiSummaryState(
                    fromUnix = FROM,
                    toUnix = TO,
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
                AiSummaryState(
                    fromUnix = FROM,
                    toUnix = TO,
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
                AiSummaryState(fromUnix = FROM, toUnix = TO, phase = SummaryPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(SummarySurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifySummary(
                AiSummaryState(fromUnix = FROM, toUnix = TO, phase = SummaryPhase.Failed, errorKind = ErrorKind.Http),
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
        val label = headerAccessibilityLabel("Helix log/trace summary", "Helix", "Get a 3-6 sentence summary.")
        assertEquals("Helix log/trace summary (Helix). Get a 3-6 sentence summary.", label)
    }

    @Test
    fun headerLabelAppendsWindowHintWhenPresent() {
        val label =
            headerAccessibilityLabel(
                "Helix log/trace summary",
                "Helix",
                "Get a 3-6 sentence summary.",
                hint = "Waiting for a valid log window…",
            )
        assertEquals(
            "Helix log/trace summary (Helix). Get a 3-6 sentence summary. Waiting for a valid log window…",
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
        assertEquals("Failed to load data", outputAccessibilityLabel(SummarySurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = SummaryOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(SummarySurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(SummarySurface.Hidden, labels))
    }

    private companion object {
        /** A valid log-window start in Unix seconds. */
        const val FROM = 1_700_000_000L

        /** A valid 30-minute window end. */
        const val TO = FROM + 30L * 60L
    }
}
