// Off-device unit tests for the pure AISpeedProfileInsights model: the stream reducer, the surface classifier
// (every loading / empty / content / error / stale / offline branch the web component resolves), the freshness
// rule, and the accessibility-label builders (TalkBack-label presence). This is the adapter/per-state
// projection test required by the acceptance gate — it deterministically asserts the render-ready surface for
// every state without a Compose host. Run by the offline :android:testReleaseUnitTest gate — no Compose, no
// Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aispeedprofileinsights

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AISpeedProfileInsightsModelTest {
    private val window = INSIGHTS_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            SpeedProfileInsightsState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(InsightsPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            SpeedProfileInsightsState(phase = InsightsPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(InsightsPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            SpeedProfileInsightsState(phase = InsightsPhase.Streaming, streamingText = "done text")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(InsightsPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            SpeedProfileInsightsState(phase = InsightsPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(InsightsPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            SpeedProfileInsightsState(phase = InsightsPhase.Streaming, committedText = "prev")
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(InsightsPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted =
            SpeedProfileInsightsState(phase = InsightsPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(InsightsPhase.Done, promoted.phase)
        val untouched = SpeedProfileInsightsState(phase = InsightsPhase.Failed).finishIfStreaming(9L)
        assertEquals(InsightsPhase.Failed, untouched.phase)
    }

    // ── canStart parity with web !!driveId ──────────────────────────────────────────
    @Test
    fun canStartMirrorsTruthyDriveId() {
        assertTrue(SpeedProfileInsightsState(driveId = "drive-1").canStart)
        assertFalse(SpeedProfileInsightsState(driveId = null).canStart)
        assertFalse(SpeedProfileInsightsState(driveId = "").canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface =
            classifyInsights(SpeedProfileInsightsState(gateEnabled = false, driveId = "drive-1"), nowMs = 0L)
        assertEquals(InsightsSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            InsightsSurface.Resting(canStart = true),
            classifyInsights(SpeedProfileInsightsState(driveId = "drive-1"), nowMs = 0L),
        )
        assertEquals(
            InsightsSurface.Resting(canStart = false),
            classifyInsights(SpeedProfileInsightsState(driveId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(driveId = "drive-1", phase = InsightsPhase.Streaming),
                nowMs = 0L,
            )
        assertEquals(InsightsSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(
                    driveId = "drive-1",
                    phase = InsightsPhase.Streaming,
                    streamingText = "partial",
                ),
                nowMs = 0L,
            )
        assertEquals(InsightsSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(
                    driveId = "drive-1",
                    phase = InsightsPhase.Done,
                    committedText = "interpreted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(InsightsSurface.Ready("interpreted", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(
                    driveId = "drive-1",
                    phase = InsightsPhase.Done,
                    committedText = "interpreted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(InsightsSurface.Ready("interpreted", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(driveId = "drive-1", phase = InsightsPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(InsightsSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(
                    driveId = "drive-1",
                    phase = InsightsPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(InsightsSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(
                    driveId = "drive-1",
                    phase = InsightsPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(InsightsSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(
                    driveId = "drive-1",
                    phase = InsightsPhase.Failed,
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(InsightsSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyInsights(
                SpeedProfileInsightsState(
                    driveId = "drive-1",
                    phase = InsightsPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(InsightsSurface.Failed(offline = false), surface)
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
            headerAccessibilityLabel("Speed-profile insights", "Helix", "Get a plain-language interpretation.")
        assertEquals("Speed-profile insights (Helix). Get a plain-language interpretation.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            InsightsOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(InsightsSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(InsightsSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(InsightsSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(InsightsSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(InsightsSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(InsightsSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(InsightsSurface.Cached("cached", offline = false), labels),
        )
        assertEquals(
            "Failed to load data",
            outputAccessibilityLabel(InsightsSurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = InsightsOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(InsightsSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(InsightsSurface.Hidden, labels))
    }
}
